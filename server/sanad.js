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
      if (!opts.some((o) => o.kind === kind)) {
        throw new Error(`سَنَد: ${f.name} / ${q.id} — تنقصه رواية «${kind}»`);
      }
    }
  }
}

/** كل لاعب يروي عن شخصيتين — أدوارٌ متساوية عمداً. */
export const FIGURES_PER_PLAYER = 2;
export const TALK_SECONDS = 90;

export function createSession(code, hostId, hostName) {
  return {
    code,
    game: 'sanad',
    status: 'lobby',              // lobby | round | over
    players: { [hostId]: newPlayer(hostId, hostName) },
    hostId,
    scores: { [hostId]: 0 },
    deck: [],                     // معرّفات الشخصيات بترتيب الجلسة
    narrators: [],                // من يروي عن كل شخصية
    figureIndex: 0,
    questionIndex: 0,
    phase: null,                  // pick | talk | reveal
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

/** يبدأ الجلسة: يوزّع الشخصيات ويتناوب الرواة عليها. */
export function startSession(s, pickDeck = shuffledDeck) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب', state: s };
  if (s.status !== 'lobby') return { ok: false, error: 'الجلسة بدأت', state: s };

  const [a, b] = Object.keys(s.players);
  const total = FIGURES_PER_PLAYER * 2;
  s.deck = pickDeck(total);
  // تناوبٌ صارم: أ، ب، أ، ب — فلا يروي أحدهما أكثر من الآخر
  s.narrators = Array.from({ length: total }, (_, i) => (i % 2 === 0 ? a : b));
  s.status = 'round';
  s.figureIndex = 0;
  s.questionIndex = 0;
  s.phase = 'pick';
  return { ok: true, state: s };
}

function shuffledDeck(n) {
  const pool = [...FIGURES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((f) => f.id);
}

export const currentFigure = (s) =>
  s.status === 'round' ? FIGURE_BY_ID[s.deck[s.figureIndex]] ?? null : null;

export const currentQuestion = (s) =>
  s.status === 'round' ? QUESTIONS[s.questionIndex] ?? null : null;

export const narratorId = (s) =>
  s.status === 'round' ? s.narrators[s.figureIndex] ?? null : null;

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

  s.pick = { kind, points: POINTS[kind], text: option.text };
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
    figureId: s.deck[s.figureIndex],
    questionId: currentQuestion(s).id,
    kind: s.pick.kind,
    points: s.pick.points,
    ruling,
    winnerId: winner,
    narratorId: narratorId(s),
  });
  return { ok: true, state: s, winnerId: winner, listenerRight };
}

/** ينتقل للسؤال التالي، أو للشخصية التالية، أو ينهي الجلسة. */
export function next(s) {
  if (s.phase !== 'reveal') return { ok: false, error: 'انتظر الكشف', state: s };

  s.pick = null;
  s.ruling = null;

  if (s.questionIndex < QUESTIONS.length - 1) {
    s.questionIndex += 1;
  } else if (s.figureIndex < s.deck.length - 1) {
    s.figureIndex += 1;
    s.questionIndex = 0;
  } else {
    s.status = 'over';
    s.phase = null;
    const [a, b] = Object.keys(s.players);
    s.winnerId = s.scores[a] === s.scores[b] ? null : (s.scores[a] > s.scores[b] ? a : b);
    return { ok: true, state: s, done: true };
  }

  s.phase = 'pick';
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
      figure: s.figureIndex + 1,
      figures: s.deck.length,
      question: s.questionIndex + 1,
      questions: QUESTIONS.length,
    },
    phase: s.phase,
    talkSeconds: TALK_SECONDS,
    figure: figure && { id: figure.id, name: figure.name, era: figure.era },
    question: q && { id: q.id, prompt: q.prompt, brief: q.brief },

    // الراوي وحده يرى ما يختار منه، وبنقاطه
    options: amNarrator && s.phase === 'pick'
      ? figure[q.id].map((o) => ({ kind: o.kind, points: POINTS[o.kind], text: o.text }))
      : null,

    // نصّ الرواية المختارة يصل الطرفين بلا وسمها
    told: s.pick ? { text: s.pick.text, kind: revealed ? s.pick.kind : null,
                     points: revealed ? s.pick.points : null } : null,

    ruling: s.ruling,
    // الحقيقة تُكشف بعد الحكم لا قبله
    truth: revealed && figure
      ? (figure[q.id].find((o) => o.kind === 'true')?.text ?? 'تعذّر عرض الرواية الصحيحة')
      : null,
    lastRound: revealed ? s.log[s.log.length - 1] : null,
  };
}
