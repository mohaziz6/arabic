/**
 * لعبة «مَن أنا» — آلة حالات خالصة بلا شبكة ولا نموذج لغوي.
 *
 * شخصية تتكلّم عن نفسها، وتلميحٌ جديد كل خمس عشرة ثانية. الميدان مفتوح
 * للخصمين طوال الوقت، و**قيمة الشخصية تتناقص مع كل تلميح** (٦ ثم ٥ … ثم ١):
 * فالمعضلة هي اللعبة — أُجازف الآن بتخمينٍ غامضٍ غالٍ، أم أنتظر فيرخص الثمن
 * ويسبقني خصمي؟ ومن أخطأ **قُفل عليه حتى التلميح التالي** لا حتى آخر الشخصية.
 *
 * المؤقّت نفسه ليس هنا: الخادم يستدعي `advanceClue` كل دورة (انظر index.js)،
 * فتبقى هذه الوحدة خالصةً تُختبر بلا انتظار.
 *
 * المواصفة في docs/man-ana.md
 */

import { FIGURES, FIGURE_BY_ID, POINTS_BY_CLUE } from './man-ana-figures.js';

export const FIGURES_PER_SESSION = 3;
export const CLUE_SECONDS = 15;
export const CLUES_PER_FIGURE = POINTS_BY_CLUE.length;

/* ─────────── تطبيع الجواب العربي ─────────── */

const TASHKEEL = /[ً-ْٰـۖ-ۭ]/g;

/**
 * يوحّد صيغة الجواب: بلا تشكيل ولا تطويل، والألف بكل هيئاتها ألف، والياء
 * والألف المقصورة واحدة، والتاء المربوطة هاء. فلا يُطالَب اللاعب بضبطٍ ولا
 * همزةٍ ولا يُحرَم نقطته لأنه كتب «ابن سينا» بدل «ابن سِينا».
 */
export function normalize(text) {
  return String(text ?? '')
    .replace(TASHKEEL, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/[^؀-ۿ\s]/g, ' ')   // علامات الترقيم ليست جزءاً من الاسم
    .replace(/\s+/g, ' ')
    .trim();
}

/** أداة التعريف تُقبل وتُترك: «المتنبي» و«متنبي» سواء. */
const stripAl = (t) => t.split(' ').map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w)).join(' ');

/** الصيغ التي يُقبل بها جوابٌ واحد. */
const formsOf = (text) => {
  const n = normalize(text);
  return n ? new Set([n, stripAl(n)]) : new Set();
};

/** هل تظهر كلمات `needle` متتاليةً داخل كلمات `hay`؟ */
function hasRun(hay, needle) {
  const H = hay.split(' ');
  const N = needle.split(' ');
  if (N.length === 0 || N.length > H.length) return false;
  outer: for (let i = 0; i + N.length <= H.length; i++) {
    for (let j = 0; j < N.length; j++) if (H[i + j] !== N[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * هل يطابق ما كتبه اللاعب أحد أسماء الشخصية؟
 *
 * المطابقة **احتواءٌ لا تساوٍ**: من كتب «الشاعر المتنبي» أو «أبو الطيب أحمد بن
 * الحسين المتنبي» فقد عرفه، ورفضُه يقفل عليه خمس عشرة ثانية ويبدو عطلاً لا لعبة.
 * والعكس مرفوض: «سينا» وحدها ليست «ابن سينا» — فالاسم يجب أن يَرِد كاملاً
 * متتالياً داخل ما كُتب، لا أن تكفي كلمةٌ منه.
 */
export function matches(figure, text) {
  const given = formsOf(text);
  if (given.size === 0) return false;
  return figure.aliases.some((a) => {
    for (const alias of formsOf(a)) {
      for (const said of given) if (hasRun(said, alias)) return true;
    }
    return false;
  });
}

/* ─────────── تحقّق عند التحميل ─────────── */
/* خطأٌ في شخصية يجب أن يوقف الخادم عند الإقلاع، لا أن ينكشف وسط جلسة. */

if (FIGURES.length < FIGURES_PER_SESSION) {
  throw new Error(`من أنا: يلزم ${FIGURES_PER_SESSION} شخصيات على الأقل`);
}

const seenIds = new Set();
for (const f of FIGURES) {
  if (seenIds.has(f.id)) throw new Error(`من أنا: معرّف مكرّر «${f.id}»`);
  seenIds.add(f.id);

  if (!Array.isArray(f.clues) || f.clues.length !== CLUES_PER_FIGURE) {
    throw new Error(`من أنا: ${f.name} — يلزم ${CLUES_PER_FIGURE} تلميحات لا ${f.clues?.length}`);
  }
  if (!Array.isArray(f.aliases) || f.aliases.length === 0) {
    throw new Error(`من أنا: ${f.name} — تنقصه صيغ الجواب المقبولة`);
  }
  if (!matches(f, f.name)) {
    throw new Error(`من أنا: ${f.name} — اسمه نفسه لا يُطابق صيغه المقبولة`);
  }
  if (!f.reveal) throw new Error(`من أنا: ${f.name} — ينقصه نصّ الكشف`);

  /*
   * تلميحٌ يذكر الاسم يُهدي الجواب ويقتل الشخصية. الفحص على النصّ المطبَّع
   * فلا تفلت «المتنبّي» من «المتنبي».
   */
  for (const [i, clue] of f.clues.entries()) {
    const flat = normalize(clue);
    for (const alias of f.aliases) {
      for (const form of formsOf(alias)) {
        // بلا فحص الصيغتين يفلت «خوارزمية» من «الخوارزمي» فيُهدى الجواب
        if (form.length > 3 && flat.includes(form)) {
          throw new Error(`من أنا: ${f.name} — التلميح ${i + 1} يذكر الجواب «${alias}»`);
        }
      }
    }
  }
}

/* ─────────── الجلسة ─────────── */

export function createSession(code, hostId, hostName) {
  return {
    code,
    game: 'man-ana',
    status: 'lobby',           // lobby | round | over
    players: { [hostId]: newPlayer(hostId, hostName) },
    hostId,
    scores: { [hostId]: 0 },
    deck: [],                  // معرّفات الشخصيات بترتيب الجلسة
    figureIndex: 0,
    clueIndex: 0,              // آخر تلميح ظهر (٠ = الأول)
    phase: null,               // clues | reveal
    lockedAt: {},              // playerId -> رقم التلميح الذي أخطأ فيه
    misses: [],                // تخمينات خاطئة في الشخصية الجارية (تُعرض للطرفين)
    solvedBy: null,
    earned: 0,
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

function shuffledDeck(n) {
  const pool = [...FIGURES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((f) => f.id);
}

export function startSession(s, pickDeck = shuffledDeck) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب', state: s };
  if (s.status !== 'lobby') return { ok: false, error: 'الجلسة بدأت', state: s };

  s.deck = pickDeck(FIGURES_PER_SESSION);
  s.status = 'round';
  s.figureIndex = 0;
  s.clueIndex = 0;
  s.phase = 'clues';
  s.lockedAt = {};
  s.misses = [];
  s.solvedBy = null;
  s.earned = 0;
  return { ok: true, state: s };
}

export const currentFigure = (s) =>
  s.status === 'round' ? FIGURE_BY_ID[s.deck[s.figureIndex]] ?? null : null;

/** قيمة الشخصية الآن — تتناقص مع كل تلميح. */
export const currentPoints = (s) => POINTS_BY_CLUE[s.clueIndex] ?? POINTS_BY_CLUE.at(-1);

/** من أخطأ في هذا التلميح مقفولٌ حتى يأتي الذي بعده. */
export const isLocked = (s, playerId) => s.lockedAt[playerId] === s.clueIndex;

/**
 * تخمين لاعب. أول إصابة تأخذ قيمة التلميح الحالي وتُنهي الشخصية،
 * والخطأ يُقفل صاحبه حتى التلميح التالي ويُعرض نصّه للطرفين.
 */
export function guess(s, playerId, text) {
  if (s.status !== 'round' || s.phase !== 'clues') return { ok: false, error: 'ليست مرحلة تخمين', state: s };
  if (!s.players[playerId]) return { ok: false, error: 'لست في هذا الديوان', state: s };
  if (isLocked(s, playerId)) return { ok: false, error: 'انتظر التلميح التالي', state: s };

  const said = String(text ?? '').slice(0, 60);
  if (!normalize(said)) return { ok: false, error: 'اكتب اسماً', state: s };

  const figure = currentFigure(s);
  const correct = matches(figure, said);

  if (!correct) {
    s.lockedAt[playerId] = s.clueIndex;
    s.misses.push({ playerId, text: said, clue: s.clueIndex });
    return { ok: true, state: s, correct: false, solved: false };
  }

  const points = currentPoints(s);
  s.scores[playerId] += points;
  s.solvedBy = playerId;
  s.earned = points;
  s.phase = 'reveal';
  s.log.push({
    figureId: figure.id,
    solvedBy: playerId,
    clue: s.clueIndex,
    points,
    misses: s.misses.length,
  });
  return { ok: true, state: s, correct: true, solved: true, points };
}

/**
 * يكشف التلميح التالي — يستدعيه الخادم كل `CLUE_SECONDS`.
 * عند نفاد التلميحات تُطوى الشخصية بلا نقاط لأحد.
 */
export function advanceClue(s) {
  if (s.status !== 'round' || s.phase !== 'clues') return { ok: false, state: s };

  if (s.clueIndex < CLUES_PER_FIGURE - 1) {
    s.clueIndex += 1;
    return { ok: true, state: s, clue: s.clueIndex };
  }

  // انقضى آخر تلميح ولم يُصِب أحد
  s.phase = 'reveal';
  s.solvedBy = null;
  s.earned = 0;
  s.log.push({
    figureId: currentFigure(s).id,
    solvedBy: null,
    clue: s.clueIndex,
    points: 0,
    misses: s.misses.length,
  });
  return { ok: true, state: s, exhausted: true };
}

/** ينتقل للشخصية التالية أو ينهي الجلسة. */
export function next(s) {
  if (s.phase !== 'reveal') return { ok: false, error: 'انتظر الكشف', state: s };

  s.lockedAt = {};
  s.misses = [];
  s.solvedBy = null;
  s.earned = 0;

  if (s.figureIndex < s.deck.length - 1) {
    s.figureIndex += 1;
    s.clueIndex = 0;
    s.phase = 'clues';
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
 * **اسم الشخصية وصيغه ونصّ كشفها لا تغادر الخادم قبل الحلّ** — ولا التلميحات
 * التي لم يحن وقتها بعد. لو أُرسلت محجوبةً بالـ CSS لقُرئت من أدوات المطوّر
 * في ثانية، وانتهت اللعبة كلها.
 */
export function viewFor(s, viewerId) {
  const figure = currentFigure(s);
  const oppId = opponentOf(s, viewerId);
  const revealed = s.phase === 'reveal';

  return {
    game: 'man-ana',
    code: s.code,
    status: s.status,
    scores: s.scores,
    winnerId: s.winnerId,
    me: s.players[viewerId] ?? null,
    opponent: oppId ? s.players[oppId] : null,
    progress: {
      figure: s.figureIndex + 1,
      figures: s.deck.length || FIGURES_PER_SESSION,
      clue: s.clueIndex + 1,
      clues: CLUES_PER_FIGURE,
    },
    phase: s.phase,
    clueSeconds: CLUE_SECONDS,
    points: currentPoints(s),
    pointsLadder: POINTS_BY_CLUE,

    // التلميحات التي ظهرت فقط — وما بعدها لم يُرسَل أصلاً
    clues: figure ? figure.clues.slice(0, s.clueIndex + 1) : [],
    era: figure && s.clueIndex > 0 ? figure.era : null,

    iLocked: isLocked(s, viewerId),
    oppLocked: oppId ? isLocked(s, oppId) : false,
    // التخمين الخاطئ يُعرض للطرفين بنصّه: جزءٌ من المتعة، ومعلومةٌ مكسوبة
    misses: s.misses.map((m) => ({ ...m, mine: m.playerId === viewerId })),

    solvedBy: s.solvedBy,
    earned: s.earned,
    answer: revealed && figure ? { name: figure.name, era: figure.era, reveal: figure.reveal } : null,
    lastRound: revealed ? s.log[s.log.length - 1] ?? null : null,
  };
}
