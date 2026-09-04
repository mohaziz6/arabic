/**
 * لعبة «مَعاني» — آلة حالات خالصة بلا شبكة ولا نموذج لغوي.
 *
 * سباقٌ متزامن: السؤال يظهر للخصمين معاً، وأول من يصيب يأخذ نقاطه.
 * ومن أخطأ خرج من السؤال وحده — فالخطأ يكلّف فرصةً لا وقتاً. لا مؤقّت
 * في اللعبة إطلاقاً: الجولة تنتهي بالإجابة لا بانقضاء ثوانٍ.
 *
 * المواصفة في docs/maani.md
 */

import { PAIRS, HUNTS, INTRUDERS, FILLERS, RELATIONS } from './maani-words.js';

/** أربعة أسئلة لكل مستوى — ثلاثة مستويات، فاثنا عشر سؤالاً للجلسة. */
export const QUESTIONS_PER_LEVEL = 4;
/** كلمات شبكة الحصاد: المرادف والضدّ وثلاث عشرة حشواً. */
export const GRID_SIZE = 15;
export const FAMILY_SIZE = 5;

/** النقاط تتصاعد مع المستوى: ما صعب ثمنُه أغلى. */
export const LEVELS = [
  { id: 'pair', order: 1, name: 'المقابلة', brief: 'كلمتان — أبينهما ترادف أم تضاد أم لا علاقة؟', points: 1 },
  { id: 'hunt', order: 2, name: 'الحصاد', brief: 'كلمةٌ وشبكةٌ — التقط منها المطلوب', points: 2 },
  { id: 'intruder', order: 3, name: 'الدخيل', brief: 'ستٌّ يجمعها معنًى… إلا واحدة', points: 3 },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
const RELATION_IDS = RELATIONS.map((r) => r.id);

/* ─────────── تحقّق عند التحميل ─────────── */
/* خطأٌ في بنك الكلمات يجب أن يوقف الخادم عند الإقلاع، لا أن ينكشف وسط جلسة. */

if (PAIRS.length < QUESTIONS_PER_LEVEL) throw new Error('معاني: المقابلة تحتاج أربعة أسئلة على الأقل');
if (HUNTS.length < QUESTIONS_PER_LEVEL) throw new Error('معاني: الحصاد يحتاج أربعة أسئلة على الأقل');
if (INTRUDERS.length < QUESTIONS_PER_LEVEL) throw new Error('معاني: الدخيل يحتاج أربعة أسئلة على الأقل');

for (const p of PAIRS) {
  if (!RELATION_IDS.includes(p.relation)) throw new Error(`معاني: ${p.a}/${p.b} — علاقة غير معروفة «${p.relation}»`);
  if (!p.a || !p.b || p.a === p.b) throw new Error(`معاني: ${p.a}/${p.b} — يلزم كلمتان مختلفتان`);
  if (!p.why) throw new Error(`معاني: ${p.a}/${p.b} — ينقصه تعليل يُعرض بعد الكشف`);
}

const fillerSet = new Set(FILLERS);
if (fillerSet.size !== FILLERS.length) throw new Error('معاني: في الحشو كلمة مكرّرة');
if (FILLERS.length < GRID_SIZE - 2) throw new Error('معاني: الحشو أقلّ من أن يملأ الشبكة');

for (const h of HUNTS) {
  const trio = [h.word, h.synonym, h.antonym];
  if (trio.some((w) => !w)) throw new Error(`معاني: ${h.word} — ينقصه مرادف أو ضدّ`);
  if (new Set(trio).size !== 3) throw new Error(`معاني: ${h.word} — الكلمة ومرادفها وضدّها يجب أن تختلف`);
  // حشوٌ يساوي الجواب يجعل للسؤال جوابين، فيخسر المصيبُ نقطته
  for (const w of trio) {
    if (fillerSet.has(w)) throw new Error(`معاني: ${w} في الحشو وفي الحصاد معاً`);
  }
}

for (const it of INTRUDERS) {
  if (it.family.length !== FAMILY_SIZE) throw new Error(`معاني: ${it.theme} — يلزم ${FAMILY_SIZE} كلمات في الحقل`);
  if (!it.intruder) throw new Error(`معاني: ${it.theme} — تنقصه الكلمة الدخيلة`);
  if (new Set([...it.family, it.intruder]).size !== FAMILY_SIZE + 1) {
    throw new Error(`معاني: ${it.theme} — كلمة مكرّرة بين الحقل والدخيلة`);
  }
  if (!it.why) throw new Error(`معاني: ${it.theme} — ينقصه تعليل يُعرض بعد الكشف`);
}

/* ─────────── الجلسة ─────────── */

export function createSession(code, hostId, hostName) {
  return {
    code,
    game: 'maani',
    status: 'lobby',          // lobby | round | over
    players: { [hostId]: newPlayer(hostId, hostName) },
    hostId,
    scores: { [hostId]: 0 },
    deck: [],                 // اثنا عشر سؤالاً، جوابها لا يغادر الخادم قبل الكشف
    index: 0,
    phase: null,              // ask | reveal
    answers: {},              // playerId -> { choice, correct, order }
    roundWinnerId: null,
    log: [],
    winnerId: null,
  };
}

const newPlayer = (id, name) => ({ id, name, connected: true });

export function addPlayer(s, id, name) {
  if (Object.keys(s.players).length >= 2) return { ok: false, error: 'الديوان ممتلئ' };
  if (s.players[id]) return { ok: true, state: s };
  s.players[id] = newPlayer(id, name);
  s.scores[id] = 0;
  return { ok: true, state: s };
}

export const bothPresent = (s) => Object.keys(s.players).length === 2;
export const opponentOf = (s, id) => Object.keys(s.players).find((p) => p !== id) ?? null;

/* ─────────── بناء الأسئلة ─────────── */

function shuffle(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const take = (list, n, rand) => shuffle(list, rand).slice(0, n);

/**
 * يبني أسئلة الجلسة كلها مقدماً — بترتيب الشبكات مثبّتاً في الخادم،
 * فيرى اللاعبان الترتيب نفسه ويكون السباق على معنًى واحد لا على رصفين مختلفين.
 */
export function buildDeck(rand = Math.random) {
  const pairs = take(PAIRS, QUESTIONS_PER_LEVEL, rand).map((p) => ({
    level: 'pair',
    points: LEVEL_BY_ID.pair.points,
    a: p.a,
    b: p.b,
    answer: p.relation,
    why: p.why,
  }));

  const hunts = take(HUNTS, QUESTIONS_PER_LEVEL, rand).map((h) => {
    const mode = rand() < 0.5 ? 'synonym' : 'antonym';
    const answer = mode === 'synonym' ? h.synonym : h.antonym;
    const decoy = mode === 'synonym' ? h.antonym : h.synonym;
    const filler = take(FILLERS, GRID_SIZE - 2, rand);
    return {
      level: 'hunt',
      points: LEVEL_BY_ID.hunt.points,
      word: h.word,
      mode,
      grid: shuffle([answer, decoy, ...filler], rand),
      answer,
      why: mode === 'synonym'
        ? `«${answer}» مرادفُ «${h.word}»، و«${decoy}» ضدُّها — وهو الفخّ.`
        : `«${answer}» ضدُّ «${h.word}»، و«${decoy}» مرادفُها — وهو الفخّ.`,
    };
  });

  const intruders = take(INTRUDERS, QUESTIONS_PER_LEVEL, rand).map((it) => ({
    level: 'intruder',
    points: LEVEL_BY_ID.intruder.points,
    theme: it.theme,
    words: shuffle([...it.family, it.intruder], rand),
    answer: it.intruder,
    why: it.why,
  }));

  return [...pairs, ...hunts, ...intruders];
}

export function startSession(s, build = buildDeck) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب', state: s };
  if (s.status !== 'lobby') return { ok: false, error: 'الجلسة بدأت', state: s };

  s.deck = build();
  s.status = 'round';
  s.index = 0;
  s.phase = 'ask';
  s.answers = {};
  s.roundWinnerId = null;
  return { ok: true, state: s };
}

export const currentQuestion = (s) => (s.status === 'round' ? s.deck[s.index] ?? null : null);
export const currentLevel = (s) => {
  const q = currentQuestion(s);
  return q ? LEVEL_BY_ID[q.level] : null;
};

/**
 * إجابة لاعب. **أول من يصيب يأخذ النقاط ويُغلق السؤال** — ولو لم يجب خصمه بعد،
 * فتلك هي المسابقة. ومن أخطأ خرج وحده وبقي للخصم مجالُه.
 */
export function answer(s, playerId, choice) {
  if (s.status !== 'round' || s.phase !== 'ask') return { ok: false, error: 'ليست مرحلة إجابة', state: s };
  if (!s.players[playerId]) return { ok: false, error: 'لست في هذا الديوان', state: s };
  if (s.answers[playerId]) return { ok: false, error: 'أجبتَ في هذا السؤال', state: s };

  const q = currentQuestion(s);
  const picked = String(choice ?? '');
  if (!isChoosable(q, picked)) return { ok: false, error: 'إجابة غير معروفة', state: s };

  const correct = picked === q.answer;
  s.answers[playerId] = { choice: picked, correct, order: Object.keys(s.answers).length + 1 };

  if (correct) {
    s.scores[playerId] += q.points;
    s.roundWinnerId = playerId;
  } else if (Object.keys(s.answers).length < 2) {
    // خصمه لم يجب بعد: السؤال مفتوح له وحده
    return { ok: true, state: s, correct, resolved: false };
  }

  s.phase = 'reveal';
  s.log.push({
    level: q.level,
    points: q.points,
    answer: q.answer,
    winnerId: s.roundWinnerId,
    answers: { ...s.answers },
  });
  return { ok: true, state: s, correct, resolved: true };
}

/** الجواب يجب أن يكون من المعروض فعلاً — وإلا خُمّن من خارج الشاشة. */
function isChoosable(q, choice) {
  if (q.level === 'pair') return RELATION_IDS.includes(choice);
  if (q.level === 'hunt') return q.grid.includes(choice);
  return q.words.includes(choice);
}

/** ينتقل للسؤال التالي أو ينهي الجلسة. متاحٌ للطرفين — لا ينتظر الخاسر. */
export function next(s) {
  if (s.phase !== 'reveal') return { ok: false, error: 'انتظر الكشف', state: s };

  s.answers = {};
  s.roundWinnerId = null;

  if (s.index < s.deck.length - 1) {
    s.index += 1;
    s.phase = 'ask';
    return { ok: true, state: s };
  }

  s.status = 'over';
  s.phase = null;
  const [a, b] = Object.keys(s.players);
  s.winnerId = s.scores[a] === s.scores[b] ? null : (s.scores[a] > s.scores[b] ? a : b);
  return { ok: true, state: s, done: true };
}

/**
 * لقطة الحالة لعين لاعب بعينه.
 *
 * **الجواب لا يغادر الخادم قبل الكشف** — لا في `answer` ولا في `why`. ولو أُرسل
 * محجوباً بالـ CSS لقُرئ من أدوات المطور في ثانية، وانتهى السباق كلّه.
 * وكذلك اختيار الخصم: يُرى بعد الكشف لا أثناء السؤال، وإلا نُسخ منه.
 */
export function viewFor(s, viewerId) {
  const q = currentQuestion(s);
  const level = currentLevel(s);
  const oppId = opponentOf(s, viewerId);
  const revealed = s.phase === 'reveal';
  const mine = s.answers[viewerId] ?? null;
  const theirs = oppId ? s.answers[oppId] ?? null : null;

  return {
    game: 'maani',
    code: s.code,
    status: s.status,
    scores: s.scores,
    winnerId: s.winnerId,
    me: s.players[viewerId] ?? null,
    opponent: oppId ? s.players[oppId] : null,
    progress: {
      question: s.index + 1,
      questions: s.deck.length || LEVELS.length * QUESTIONS_PER_LEVEL,
      inLevel: (s.index % QUESTIONS_PER_LEVEL) + 1,
      perLevel: QUESTIONS_PER_LEVEL,
      level: level?.order ?? 0,
      levels: LEVELS.length,
    },
    level: level && { id: level.id, name: level.name, brief: level.brief, points: level.points },
    phase: s.phase,

    // المعروض فقط: لا `answer` ولا `why` قبل الكشف
    question: q && (
      q.level === 'pair' ? { level: 'pair', a: q.a, b: q.b, relations: RELATIONS }
        : q.level === 'hunt' ? { level: 'hunt', word: q.word, mode: q.mode, grid: q.grid }
          : { level: 'intruder', words: q.words }
    ),

    myAnswer: mine,
    // قبل الكشف يُعلَم أنه أجاب لا بماذا أجاب
    oppAnswered: Boolean(theirs),
    oppAnswer: revealed ? theirs : null,
    solution: revealed && q ? { answer: q.answer, why: q.why, winnerId: s.roundWinnerId, points: q.points } : null,
    lastRound: revealed ? s.log[s.log.length - 1] ?? null : null,
  };
}
