/**
 * لعبة «سَنَد» — آلة حالات خالصة بلا شبكة ولا نموذج لغوي.
 *
 * الحكم للخصم لا للوكيل، فلا نداء ولا تكلفة. المواصفة في docs/sanad.md
 */

import { FIGURES, FIGURE_BY_ID, QUESTIONS, POINTS } from './sanad-figures.js';

// تحقّق عند التحميل: خطأ في شخصية يجب أن ينكشف عند تشغيل الخادم لا وسط جلسة
for (const f of FIGURES) {
  for (const q of QUESTIONS) {
    const opts = f[q.id];
    if (!Array.isArray(opts) || opts.length !== 3) {
      throw new Error(`سَنَد: ${f.name} / ${q.id} — يلزم ثلاث روايات`);
    }
    for (const kind of ['true', 'crafted', 'absurd']) {
      const o = opts.find((x) => x.kind === kind);
      if (!o) throw new Error(`سَنَد: ${f.name} / ${q.id} — تنقصه رواية «${kind}»`);

      // بلا هذا التحقّق تمرّ روايةٌ بلا تلميح فيرى الخصم شارةً فارغة وسط جلسة
      const words = String(o.hint ?? '').trim().split(/\s+/).filter(Boolean).length;
      if (words !== 4) {
        throw new Error(`سَنَد: ${f.name} / ${q.id} / ${kind} — التلميح ${words} كلمات لا أربعاً`);
      }
      if (o.text.includes(o.hint)) {
        throw new Error(`سَنَد: ${f.name} / ${q.id} / ${kind} — التلميح مقتطع من الرواية حرفياً`);
      }
    }
  }
}

export const TALK_SECONDS = 90;

/**
 * جولات الجلسة، والراوي يتناوب عليها **جولةً جولة** — ستٌّ لكلٍّ.
 *
 * كان العدد يُشتقّ من «شخصيتين لكل لاعب × ثلاثة أسئلة»، وذلك البناء زال حين
 * صار الراوي ينتقي بطاقته من قرعةٍ في مطلع كل جولة: لم تعد ثمّة «شخصيةُ لاعب»
 * ولا ثلاثيّةُ أسئلةٍ متتابعة. فالعدد اليوم ثابتٌ مقصود لا حاصلُ ضربٍ يشرح نفسه.
 */
export const ROUNDS = 12;

/** الشخصيات المعروضة على الراوي في مطلع كل جولة. */
export const OFFER_SIZE = 3;

const cardKey = (c) => `${c.figureId}:${c.questionId}`;

export function createSession(code, hostId, hostName) {
  return {
    code,
    game: 'sanad',
    status: 'lobby',              // lobby | round | over
    players: { [hostId]: newPlayer(hostId, hostName) },
    hostId,
    scores: { [hostId]: 0 },
    narrators: [],                // من يروي في كل جولة
    roundNo: 0,
    used: [],                     // بطاقاتٌ استُهلكت: "figureId:questionId"
    offer: [],                    // بطاقات القرعة الثلاث للجولة الجارية
    chosen: null,                 // { figureId, questionId } بعد قرعة الراوي
    phase: null,                  // draw | pick | talk | reveal
    pick: null,                   // { kind, points, text } — سرّي حتى الكشف
    ruling: null,                 // trust | liar
    log: [],
    winnerId: null,
  };
}

const newPlayer = (id, name) => ({ id, name, connected: true });

export function addPlayer(s, id, name) {
  const ids = Object.keys(s.players);
  if (ids.length >= 2) return { ok: false, error: 'الديوان ممتلئ' };
  if (s.players[id]) return { ok: true, state: s };
  s.players[id] = newPlayer(id, name);
  s.scores[id] = 0;
  return { ok: true, state: s };
}

export const bothPresent = (s) => Object.keys(s.players).length === 2;
export const opponentOf = (s, id) => Object.keys(s.players).find((p) => p !== id) ?? null;

/**
 * يبدأ الجلسة ويجري قرعة الجولة الأولى.
 *
 * **الراوي يتناوب جولةً جولة** لا شخصيةً شخصية: صار لكل جولةٍ شخصيتُها التي
 * ينتقيها صاحبُها، فالتناوب على الجولات هو العادل.
 */
export function startSession(s, deal = dealOffer) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب', state: s };
  if (s.status !== 'lobby') return { ok: false, error: 'الجلسة بدأت', state: s };

  const [a, b] = Object.keys(s.players);
  // تناوبٌ صارم: أ، ب، أ، ب — فلا يروي أحدهما أكثر من الآخر
  s.narrators = Array.from({ length: ROUNDS }, (_, i) => (i % 2 === 0 ? a : b));
  s.status = 'round';
  s.roundNo = 0;
  s.used = [];
  s.chosen = null;
  s.offer = deal(s);
  s.phase = 'draw';
  return { ok: true, state: s };
}

/**
 * يوزّع ثلاث بطاقات: **شخصياتٌ مختلفة**، لكلٍّ سؤالٌ لم يُستهلك بعد.
 *
 * البطاقة (شخصية + سؤال) لا الشخصية وحدها: فالشخصية قد تعود في جولةٍ لاحقة
 * بسؤالٍ آخر، وبذلك يكفي بنكُ السبع عشرة لاثنتي عشرة جولة بلا ضيق.
 */
function dealOffer(s) {
  const used = new Set(s.used);
  const pool = [];
  for (const f of FIGURES) {
    const free = QUESTIONS.filter((q) => !used.has(`${f.id}:${q.id}`));
    if (free.length) pool.push({ figureId: f.id, free });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, OFFER_SIZE).map(({ figureId, free }) => ({
    figureId,
    questionId: free[Math.floor(Math.random() * free.length)].id,
  }));
}

export const currentFigure = (s) =>
  (s.status === 'round' && s.chosen) ? FIGURE_BY_ID[s.chosen.figureId] ?? null : null;

export const currentQuestion = (s) =>
  (s.status === 'round' && s.chosen)
    ? QUESTIONS.find((q) => q.id === s.chosen.questionId) ?? null : null;

export const narratorId = (s) =>
  s.status === 'round' ? s.narrators[s.roundNo] ?? null : null;

/**
 * الراوي يسحب بطاقةً من الثلاث. **الاختيار الأول من اثنين**: ينتقي من يحسن
 * الكذب عليه، ثم ينتقي روايته منه — وهذا عكس ما كان (شخصيةٌ تأتيه عشوائياً).
 */
export function drawPick(s, playerId, index) {
  if (s.phase !== 'draw') return { ok: false, error: 'ليست مرحلة قرعة', state: s };
  if (narratorId(s) !== playerId) return { ok: false, error: 'لستَ الراوي', state: s };

  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= s.offer.length) {
    return { ok: false, error: 'بطاقة غير موجودة', state: s };
  }

  s.chosen = { ...s.offer[i], index: i };
  s.used.push(cardKey(s.chosen));
  s.phase = 'pick';
  return { ok: true, state: s, card: s.chosen };
}

export const listenerId = (s) => {
  const n = narratorId(s);
  return n ? opponentOf(s, n) : null;
};

/** الراوي يختار روايته سرّاً. النقاط معلومة له مقدماً — القرار يجب أن يكون واعياً. */
export function choose(s, playerId, kind) {
  if (s.phase !== 'pick') return { ok: false, error: 'ليست مرحلة اختيار', state: s };
  if (narratorId(s) !== playerId) return { ok: false, error: 'لستَ الراوي', state: s };

  const q = currentQuestion(s);
  const option = currentFigure(s)?.[q.id]?.find((o) => o.kind === kind);
  if (!option) return { ok: false, error: 'رواية غير معروفة', state: s };

  s.pick = { kind, points: POINTS[kind], text: option.text, hint: option.hint };
  s.phase = 'talk';
  return { ok: true, state: s };
}

/**
 * الخصم يحكم. **المُحقّ يأخذ نقاط الخيار** — قاعدة واحدة تحكم كل الحالات،
 * ونتيجتها أن قول الصدق نفسه خدعة مشروعة.
 */
export function rule(s, playerId, ruling) {
  if (s.phase !== 'talk') return { ok: false, error: 'ليست مرحلة حكم', state: s };
  if (listenerId(s) !== playerId) return { ok: false, error: 'الحكم لخصمك', state: s };
  if (ruling !== 'trust' && ruling !== 'liar') return { ok: false, error: 'حكم غير معروف', state: s };

  const wasTrue = s.pick.kind === 'true';
  const listenerRight = (ruling === 'trust') === wasTrue;
  const winner = listenerRight ? playerId : narratorId(s);

  s.scores[winner] += s.pick.points;
  s.ruling = ruling;
  s.phase = 'reveal';
  s.log.push({
    figureId: s.chosen.figureId,
    questionId: s.chosen.questionId,
    kind: s.pick.kind,
    points: s.pick.points,
    ruling,
    winnerId: winner,
    narratorId: narratorId(s),
  });
  return { ok: true, state: s, winnerId: winner, listenerRight };
}

/** ينتقل إلى قرعة الجولة التالية، أو ينهي الجلسة. */
export function next(s, deal = dealOffer) {
  if (s.phase !== 'reveal') return { ok: false, error: 'انتظر الكشف', state: s };

  s.pick = null;
  s.ruling = null;

  if (s.roundNo >= ROUNDS - 1) {
    s.status = 'over';
    s.phase = null;
    s.offer = [];
    s.chosen = null;
    const [a, b] = Object.keys(s.players);
    s.winnerId = s.scores[a] === s.scores[b] ? null : (s.scores[a] > s.scores[b] ? a : b);
    return { ok: true, state: s, done: true };
  }

  s.roundNo += 1;
  s.chosen = null;
  s.offer = deal(s);
  s.phase = 'draw';
  return { ok: true, state: s };
}

/**
 * لقطة الحالة لعين لاعب بعينه.
 *
 * **الخيارات الثلاثة لا تصل إلا الراوي.** والخصم لا يرى نوع الرواية ولا نقاطها
 * قبل الكشف — لو أُرسلا لانكشفت اللعبة من أدوات المطور في ثانية.
 */
export function viewFor(s, viewerId) {
  const figure = currentFigure(s);
  const q = currentQuestion(s);
  const nId = narratorId(s);
  const amNarrator = nId === viewerId;
  const oppId = opponentOf(s, viewerId);
  const revealed = s.phase === 'reveal';

  return {
    game: 'sanad',
    code: s.code,
    status: s.status,
    scores: s.scores,
    winnerId: s.winnerId,
    me: s.players[viewerId] && { ...s.players[viewerId], isNarrator: amNarrator },
    opponent: oppId ? { ...s.players[oppId], isNarrator: nId === oppId } : null,
    progress: {
      round: s.roundNo + 1,
      rounds: ROUNDS,
    },
    phase: s.phase,
    talkSeconds: TALK_SECONDS,
    figure: figure && { id: figure.id, name: figure.name, era: figure.era },
    question: q && { id: q.id, prompt: q.prompt, brief: q.brief },

    /*
     * بطاقات القرعة **تُعرض للطرفين** (قرار مستخدم صريح): من رأى خصمه يترك
     * المتنبي ويختار غيره عرف شيئاً عنه، وهي معلومةٌ يبني عليها شكَّه ومتعةٌ
     * في ذاتها. ولا سرَّ فيها أصلاً — الأسرارُ في الروايات لا في الأسماء.
     */
    offer: s.offer.map((c) => {
      const f = FIGURE_BY_ID[c.figureId];
      const qq = QUESTIONS.find((x) => x.id === c.questionId);
      return {
        figure: f && { id: f.id, name: f.name, era: f.era },
        question: qq && { id: qq.id, prompt: qq.prompt, brief: qq.brief },
      };
    }),
    chosenIndex: s.chosen ? s.chosen.index : null,
    myDraw: s.phase === 'draw' && amNarrator,

    // الراوي وحده يرى ما يختار منه، وبنقاطه
    options: amNarrator && s.phase === 'pick'
      ? figure[q.id].map((o) => ({ kind: o.kind, points: POINTS[o.kind], text: o.text }))
      : null,

    /*
     * الراوي يرى روايته كاملة ليقرأ منها. والخصم لا يصله إلا **تلميح** من أربع
     * كلمات يعطيه فكرتها بلا وسمها — ليعرف عمّ يسأل، ويُنصت إلى الباقي.
     * التلميح مكتوب مع الرواية لا مقتطع منها، فلا يفضح ألفاظها.
     */
    told: s.pick
      ? {
          text: (amNarrator || revealed) ? s.pick.text : null,
          hint: s.pick.hint,
          kind: revealed ? s.pick.kind : null,
          points: revealed ? s.pick.points : null,
        }
      : null,

    ruling: s.ruling,
    // الحقيقة تُكشف بعد الحكم لا قبله
    truth: revealed && figure
      ? (figure[q.id].find((o) => o.kind === 'true')?.text ?? 'تعذّر عرض الرواية الصحيحة')
      : null,
    lastRound: revealed ? s.log[s.log.length - 1] : null,
  };
}
