/**
 * لعبة «المزاد» — آلة حالات خالصة بلا شبكة ولا نموذج لغوي ولا بنك محتوى.
 *
 * **لعبة يدويّة**: التحدي يكتبه اللاعبان بأنفسهما، والوقت والنقاط يضبطانهما،
 * والحكم بضغطة منهما. فلا شيء هنا يعرف «الجواب الصحيح» — التطبيق لوحُ مزادٍ
 * ومؤقّتٌ ومسجّل إجابات، والعقلُ عقلُ اللاعبَين.
 *
 * ولذلك **لا سرّ في هذه اللعبة**: `viewFor` متماثلة للطرفين إلا في تمييز
 * «أنا» من «خصمي». وهذا مقصود لا نقص — من يكتب الشرط يراه خصمه، فهما يتفقان.
 *
 * **كلاهما يملك كل الأدوات** (قرار مستخدم صريح): أيّهما يكتب الشرط ويضبط الوقت
 * والنقاط ويوقف العدّاد ويحكم. الاستثناء الوحيد **دور المزايدة** — فهو تناوبٌ
 * بطبيعته، ولولاه لم يكن مزاداً.
 *
 * المؤقّت هنا بيانات لا `setTimeout`: `leftMs` و`startedAt`، والحسابُ دالّة
 * خالصة تأخذ `now`. الجدولة الفعلية في index.js — فتُختبر هذه بلا انتظار.
 *
 * المواصفة في docs/mazad.md
 */

export const DEFAULT_SECONDS = 60;
export const DEFAULT_POINTS = 5;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 900;
export const MAX_POINTS = 99;
export const MAX_BID = 99;
export const MAX_ANSWERS = 60;
export const TEXT_MAX = 200;
export const ANSWER_MAX = 60;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : NaN);
const trim = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function createSession(code, hostId, hostName) {
  return {
    code,
    game: 'mazad',
    status: 'lobby',            // lobby | round | over
    players: { [hostId]: newPlayer(hostId, hostName) },
    hostId,
    scores: { [hostId]: 0 },
    roundNo: 0,
    phase: null,                // setup | bidding | challenge | judged
    round: null,
    log: [],                    // خلاصة كل جولة منتهية
    winnerId: null,
  };
}

const newPlayer = (id, name) => ({ id, name, connected: true });

const freshRound = () => ({
  text: '',
  seconds: DEFAULT_SECONDS,
  points: DEFAULT_POINTS,
  bid: 0,
  bidderId: null,              // صاحب آخر مزايدة
  turnId: null,                // دور من الآن في المزايدة
  bids: [],                    // [{ playerId, amount }] — سجلّ الزيادات
  challengerId: null,          // من قبِل التحدي (سُلِّم إليه)
  answers: [],                 // [{ text, by }] — أيّهما يضيف أو يحذف
  timer: { running: false, leftMs: DEFAULT_SECONDS * 1000, startedAt: null },
  done: null,                  // true أجابها | false عجز
  earnedBy: null,
  earned: 0,
});

export function addPlayer(s, id, name) {
  if (Object.keys(s.players).length >= 2) return { ok: false, error: 'الديوان ممتلئ' };
  if (s.players[id]) return { ok: true, state: s };
  s.players[id] = newPlayer(id, name);
  s.scores[id] = 0;
  return { ok: true, state: s };
}

export const bothPresent = (s) => Object.keys(s.players).length === 2;
export const opponentOf = (s, id) => Object.keys(s.players).find((p) => p !== id) ?? null;

const inRound = (s) => s.status === 'round' && s.round;

/* ─────────── المؤقّت (بيانات لا مؤقّتات) ─────────── */

/** ما تبقّى الآن — دالّة خالصة تأخذ `now`، فتُختبر بلا انتظار ثانية. */
export function timeLeft(s, now = Date.now()) {
  const t = s.round?.timer;
  if (!t) return 0;
  if (!t.running) return Math.max(0, t.leftMs);
  return Math.max(0, t.leftMs - (now - t.startedAt));
}

/** يثبّت ما تبقّى في `leftMs` ويوقف الجريان — تُستدعى قبل كل تعديل على المؤقّت. */
function freeze(s, now) {
  const t = s.round.timer;
  t.leftMs = timeLeft(s, now);
  t.running = false;
  t.startedAt = null;
}

export function timerStart(s, now = Date.now()) {
  if (!inRound(s) || s.phase !== 'challenge') return { ok: false, error: 'ليست مرحلة تحدٍّ', state: s };
  const t = s.round.timer;
  if (t.running) return { ok: true, state: s };
  if (t.leftMs <= 0) return { ok: false, error: 'الوقت منتهٍ — صفّره أولاً', state: s };
  t.running = true;
  t.startedAt = now;
  return { ok: true, state: s };
}

export function timerPause(s, now = Date.now()) {
  if (!inRound(s) || !s.round.timer.running) return { ok: true, state: s };
  freeze(s, now);
  return { ok: true, state: s };
}

export function timerReset(s, now = Date.now()) {
  if (!inRound(s)) return { ok: false, error: 'لا جولة', state: s };
  freeze(s, now);
  s.round.timer.leftMs = s.round.seconds * 1000;
  return { ok: true, state: s };
}

/** يزيد أو ينقص ثوانٍ وسط الجولة — من أدوات المرونة التي تقوم عليها اللعبة. */
export function timerAdjust(s, deltaSeconds, now = Date.now()) {
  if (!inRound(s)) return { ok: false, error: 'لا جولة', state: s };
  const d = int(deltaSeconds);
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: 'مقدار غير صالح', state: s };

  const wasRunning = s.round.timer.running;
  freeze(s, now);
  s.round.timer.leftMs = clamp(s.round.timer.leftMs + d * 1000, 0, MAX_SECONDS * 1000);
  if (wasRunning && s.round.timer.leftMs > 0) {
    s.round.timer.running = true;
    s.round.timer.startedAt = now;
  }
  return { ok: true, state: s };
}

/* ─────────── الجولة ─────────── */

export function startSession(s) {
  if (!bothPresent(s)) return { ok: false, error: 'ينقص لاعب', state: s };
  if (s.status !== 'lobby') return { ok: false, error: 'الجلسة بدأت', state: s };
  s.status = 'round';
  s.roundNo = 1;
  s.phase = 'setup';
  s.round = freshRound();
  return { ok: true, state: s };
}

/**
 * ضبط شرط الجولة — **أيّ اللاعبَين**، وكل حقلٍ وحده.
 * يعمل في الإعداد وفي أثناء التحدي: تعديل النقاط بعد الاتفاق من صميم اللعبة.
 */
export function configure(s, patch = {}) {
  if (!inRound(s)) return { ok: false, error: 'لا جولة', state: s };
  const r = s.round;

  // تحقُّقٌ كاملٌ **قبل** أي تعديل: رقعةٌ فيها حقلٌ فاسد تُرفض كلُّها ولا تُطبَّق
  // نصفها. ولولا ذلك لبقي التعديل الأول في الخادم بلا بثٍّ (المناولة لا تبثّ عند
  // الرفض) فيرى صاحبُه شرطاً لا يراه خصمه.
  const next = {};
  if (patch.text !== undefined) {
    if (s.phase !== 'setup') return { ok: false, error: 'الشرط لا يُبدَّل بعد فتح المزاد', state: s };
    next.text = trim(patch.text, TEXT_MAX);
  }
  if (patch.seconds !== undefined) {
    const n = int(patch.seconds);
    if (!Number.isFinite(n)) return { ok: false, error: 'وقت غير صالح', state: s };
    next.seconds = clamp(n, MIN_SECONDS, MAX_SECONDS);
  }
  if (patch.points !== undefined) {
    const n = int(patch.points);
    if (!Number.isFinite(n)) return { ok: false, error: 'نقاط غير صالحة', state: s };
    next.points = clamp(n, 1, MAX_POINTS);
  }
  if (!Object.keys(next).length) return { ok: false, error: 'لا تعديل', state: s };

  if (next.text !== undefined) r.text = next.text;
  if (next.points !== undefined) r.points = next.points;
  if (next.seconds !== undefined) {
    r.seconds = next.seconds;
    // ما لم ينطلق العدّاد بعد، يتبع الرصيدُ الإعدادَ
    if (!r.timer.running && s.phase !== 'challenge') r.timer.leftMs = r.seconds * 1000;
  }
  return { ok: true, state: s };
}

/** يفتح المزاد بأول مزايدة. الشرط يجب أن يكون مكتوباً — وإلا على ماذا يزايدان؟ */
export function openBidding(s, playerId, amount) {
  if (!inRound(s) || s.phase !== 'setup') return { ok: false, error: 'المزاد مفتوح سلفاً', state: s };
  if (!s.players[playerId]) return { ok: false, error: 'لست في هذا الديوان', state: s };
  if (!s.round.text) return { ok: false, error: 'اكتب شرط التحدي أولاً', state: s };

  const n = int(amount);
  if (!Number.isFinite(n) || n < 1 || n > MAX_BID) return { ok: false, error: 'رقم غير صالح', state: s };

  const r = s.round;
  r.bid = n;
  r.bidderId = playerId;
  r.bids = [{ playerId, amount: n }];
  r.turnId = opponentOf(s, playerId);
  r.timer.leftMs = r.seconds * 1000;
  s.phase = 'bidding';
  return { ok: true, state: s };
}

/** يزايد فوق آخر رقم، فينتقل الدور لخصمه. */
export function raise(s, playerId, amount) {
  if (!inRound(s) || s.phase !== 'bidding') return { ok: false, error: 'ليست مرحلة مزايدة', state: s };
  if (s.round.turnId !== playerId) return { ok: false, error: 'ليس دورك', state: s };

  const n = int(amount);
  if (!Number.isFinite(n) || n > MAX_BID) return { ok: false, error: 'رقم غير صالح', state: s };
  if (n <= s.round.bid) return { ok: false, error: `زايد فوق ${s.round.bid}`, state: s };

  const r = s.round;
  r.bid = n;
  r.bidderId = playerId;
  r.bids.push({ playerId, amount: n });
  r.turnId = opponentOf(s, playerId);
  return { ok: true, state: s };
}

/**
 * «عليك — هاتها»: صاحب الدور يسلّم التحدي لخصمه بآخر رقمٍ زايده ذاك.
 * فمن زايد قد يُجبَر على إثبات ما ادّعى — وهذه هي المقامرة.
 */
export function handOver(s, playerId) {
  if (!inRound(s) || s.phase !== 'bidding') return { ok: false, error: 'ليست مرحلة مزايدة', state: s };
  if (s.round.turnId !== playerId) return { ok: false, error: 'ليس دورك', state: s };

  const r = s.round;
  r.challengerId = opponentOf(s, playerId);   // المتحدّي هو صاحب آخر مزايدة
  r.turnId = null;
  r.timer.leftMs = r.seconds * 1000;
  r.timer.running = false;
  r.timer.startedAt = null;
  s.phase = 'challenge';
  return { ok: true, state: s };
}

/* ─────────── الإجابات ─────────── */

/** يضيف إجابة — من المايك أو بالكتابة، ومن **أيّ** اللاعبَين. */
export function addAnswer(s, playerId, text) {
  if (!inRound(s) || s.phase !== 'challenge') return { ok: false, error: 'ليست مرحلة تحدٍّ', state: s };
  const t = trim(text, ANSWER_MAX);
  if (!t) return { ok: false, error: 'إجابة فارغة', state: s };
  if (s.round.answers.length >= MAX_ANSWERS) return { ok: false, error: 'امتلأت القائمة', state: s };
  s.round.answers.push({ text: t, by: playerId });
  return { ok: true, state: s, index: s.round.answers.length - 1 };
}

/**
 * يحذف إجابة بموضعها — المايك يخطئ، ولا بد من يدٍ تصحّح.
 *
 * و`text` ختمٌ على الموضع لا زينة: الزرّان ✕ بيد اللاعبَين معاً، فلو ضغطا
 * معاً على شارتين مختلفتين وصل الأمر الثاني بعد أن أزاح الأولُ المواضعَ،
 * فحُذفت شارةٌ لم يقصدها أحد. فإن لم يطابق النصُّ ما في الموضع رُفض الحذف
 * وأعاد البثُّ القائمةَ الصحيحة.
 */
export function removeAnswer(s, index, text) {
  if (!inRound(s) || s.phase !== 'challenge') return { ok: false, error: 'ليست مرحلة تحدٍّ', state: s };
  const i = int(index);
  if (!Number.isFinite(i) || i < 0 || i >= s.round.answers.length) {
    return { ok: false, error: 'موضع غير موجود', state: s };
  }
  if (text !== undefined && s.round.answers[i].text !== trim(text, ANSWER_MAX)) {
    return { ok: false, error: 'تغيّرت القائمة — أعد المحاولة', state: s };
  }
  s.round.answers.splice(i, 1);
  return { ok: true, state: s };
}

export function clearAnswers(s) {
  if (!inRound(s) || s.phase !== 'challenge') return { ok: false, error: 'ليست مرحلة تحدٍّ', state: s };
  s.round.answers = [];
  return { ok: true, state: s };
}

/* ─────────── الحكم ─────────── */

/**
 * الحكم بضغطة من أيّهما. **أجابها → للمتحدّي، عجز → لخصمه** (قرار مستخدم صريح):
 * فالمزايدة مقامرة من الطرفين — تزيد فتربح أو تسقط، وتسلّم فتربح إن سقط.
 */
export function judge(s, done, now = Date.now()) {
  if (!inRound(s) || s.phase !== 'challenge') return { ok: false, error: 'ليست مرحلة تحدٍّ', state: s };
  const r = s.round;
  freeze(s, now);                      // الحكم يوقف العدّاد

  const winner = done ? r.challengerId : opponentOf(s, r.challengerId);
  r.done = Boolean(done);
  r.earnedBy = winner;
  r.earned = r.points;
  s.scores[winner] += r.points;
  s.phase = 'judged';
  s.log.push({
    roundNo: s.roundNo,
    text: r.text,
    bid: r.bid,
    raises: r.bids.length,
    challengerId: r.challengerId,
    done: r.done,
    earnedBy: winner,
    points: r.points,
    answers: r.answers.length,
  });
  return { ok: true, state: s, winnerId: winner };
}

/** جولة جديدة تحتفظ بآخر وقتٍ ونقاطٍ ضُبطا — فلا يُعاد الضبط كل مرة. */
export function nextRound(s) {
  if (!inRound(s) || s.phase !== 'judged') return { ok: false, error: 'لم تُحكم الجولة بعد', state: s };
  const { seconds, points } = s.round;
  s.roundNo += 1;
  s.round = freshRound();
  s.round.seconds = seconds;
  s.round.points = points;
  s.round.timer.leftMs = seconds * 1000;
  s.phase = 'setup';
  return { ok: true, state: s };
}

/** تنتهي الجلسة متى شاءا — لا عدد جولات مفروضاً في لعبة يدويّة. */
export function endSession(s, now = Date.now()) {
  if (s.status !== 'round') return { ok: false, error: 'لا جلسة جارية', state: s };
  if (s.round) freeze(s, now);
  s.status = 'over';
  s.phase = null;
  const [a, b] = Object.keys(s.players);
  s.winnerId = s.scores[a] === s.scores[b] ? null : (s.scores[a] > s.scores[b] ? a : b);
  return { ok: true, state: s };
}

/* ─────────── اللقطة ─────────── */

/**
 * لقطة الحالة. **لا سرّ هنا**: اللعبة يدويّة واللاعبان يتفقان بأصواتهما،
 * فكلاهما يرى كل شيء — ولا يتغيّر إلا تمييز «أنا» من «خصمي» ودورُ المزايدة.
 */
export function viewFor(s, viewerId, now = Date.now()) {
  const oppId = opponentOf(s, viewerId);
  const r = s.round;

  return {
    game: 'mazad',
    code: s.code,
    status: s.status,
    scores: s.scores,
    winnerId: s.winnerId,
    me: s.players[viewerId] ?? null,
    opponent: oppId ? s.players[oppId] : null,
    roundNo: s.roundNo,
    phase: s.phase,
    limits: { minSeconds: MIN_SECONDS, maxSeconds: MAX_SECONDS, maxPoints: MAX_POINTS, maxBid: MAX_BID },
    round: r && {
      text: r.text,
      seconds: r.seconds,
      points: r.points,
      bid: r.bid,
      bidderId: r.bidderId,
      turnId: r.turnId,
      myTurn: r.turnId === viewerId,
      bids: r.bids,
      raises: r.bids.length,
      challengerId: r.challengerId,
      iChallenge: r.challengerId === viewerId,
      answers: r.answers,
      timer: { running: r.timer.running, leftMs: timeLeft(s, now), seconds: r.seconds },
      done: r.done,
      earnedBy: r.earnedBy,
      earned: r.earned,
    },
    lastRound: s.log[s.log.length - 1] ?? null,
    rounds: s.log.length,
  };
}
