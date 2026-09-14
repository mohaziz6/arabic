/**
 * خادم ديوان التحدي — يخدم الملفات الثابتة، ويدير الغرف، وينادي القاضي.
 *
 * المفتاح لا يغادر هنا أبداً، وكذلك البطاقات والدرجات: المتصفح لا يرى
 * إلا لقطة viewFor الخاصة به.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import * as S from './state.js';
import * as SN from './sanad.js';
import * as MN from './maani.js';
import * as MA from './man-ana.js';
import * as MZ from './mazad.js';
import * as judge from './judge.js';
import { CARD_BY_ID, PHASE_LABELS } from './rules.js';
import { loadEnv, lanAddress, ensureCert } from './setup.js';
import { pickJudge, publicJudges, JUDGE_BY_ID } from './judges.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFileUsed = loadEnv(ROOT);
const PORT = Number(process.env.PORT) || 8000;
const USE_HTTPS = process.argv.includes('--https') || process.env.HTTPS === '1';

/* ─────────── ملفات ثابتة ─────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

/** ما يُقدَّم للمتصفح: هذه الجذور وهذه الامتدادات فقط. */
const SERVE_ROOTS = ['index.html', 'assets/'];

function resolvePublic(pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');

  // لا ملفات مخفية ولا صعود خارج الجذر: .git/config و.env يحملان أسراراً
  if (rel.split('/').some((seg) => seg.startsWith('.'))) return null;
  if (!SERVE_ROOTS.some((r) => rel === r || rel.startsWith(r))) return null;
  if (!MIME[path.extname(rel)]) return null;

  const file = path.resolve(ROOT, rel);
  return file.startsWith(ROOT + path.sep) ? file : null;
}

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const file = resolvePublic(url.pathname);
  if (!file) { res.writeHead(404).end('not found'); return; }

  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] });
    res.end(body);
  });
}

const server = USE_HTTPS
  ? https.createServer(await ensureCert(ROOT), handleRequest)
  : http.createServer(handleRequest);

/* ─────────── الغرف ─────────── */

/** مدة انميشن القرعة في المتصفح — الخادم ينتظرها قبل عرض القضية.
 *  تُصفَّر في الاختبارات فلا تُبطئها. */
const REVEAL_MS = process.env.REVEAL_MS !== undefined ? Number(process.env.REVEAL_MS) : 6400;

const rooms = new Map();          // code -> { state, sockets: Map<playerId, ws> }
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const makeCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

function freshCode() {
  for (let i = 0; i < 50; i++) {
    const c = makeCode();
    if (!rooms.has(c)) return c;
  }
  throw new Error('تعذّر توليد رمز غرفة');
}

const send = (ws, type, payload) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
};

/** آلات حالات الألعاب المبنيّة — الغرفة تحمل لعبتها فتُختار منها. */
const ENGINES = { muhakama: S, sanad: SN, maani: MN, 'man-ana': MA, mazad: MZ };
const GAME_LABELS = {
  muhakama: 'المحاكمة', sanad: 'سَنَد', maani: 'مَعاني', 'man-ana': 'مَن أنا', mazad: 'المزاد',
};

const engineOf = (room) => ENGINES[room.game] ?? S;

/**
 * لكل رسالة لعبتها. بلا هذا الحارس تُدمّر رسالةُ محاكمةٍ غرفةَ سَنَد، وتصرف
 * نداءً مدفوعاً للقاضي في لعبة لا قاضي فيها. رسائل الدخول ('create'/'join')
 * ليست هنا لأنها سابقة على معرفة الغرفة.
 */
const GAME_MESSAGES = {
  muhakama: ['start-trial', 'advance', 'play-card', 'live', 'speech', 'retry-verdict', 'next-trial'],
  sanad: ['sanad-start', 'sanad-choose', 'sanad-rule', 'sanad-next'],
  maani: ['maani-start', 'maani-answer', 'maani-next'],
  'man-ana': ['man-ana-start', 'man-ana-guess', 'man-ana-next'],
  mazad: ['mazad-start', 'mazad-config', 'mazad-open', 'mazad-raise', 'mazad-hand',
          'mazad-answer', 'mazad-remove', 'mazad-clear', 'mazad-timer',
          'mazad-judge', 'mazad-next', 'mazad-end'],
};

const GAME_OF_MESSAGE = new Map(
  Object.entries(GAME_MESSAGES).flatMap(([game, types]) => types.map((t) => [t, game])),
);

/**
 * دورة التلميح في «مَن أنا» — تُقصَّر في الاختبارات فلا تُبطئها.
 *
 * الإيقاع يقوده **الخادم** لا المتصفح: لو عدّ كلُّ جهازٍ لنفسه لانحرف عن الآخر
 * فرأى أحدهما تلميحاً قبل خصمه، وهو سباقٌ على النقطة نفسها.
 */
const CLUE_MS = process.env.CLUE_MS !== undefined
  ? Number(process.env.CLUE_MS) : MA.CLUE_SECONDS * 1000;

/** يوقف مؤقّت الغرفة — يجب أن يُستدعى قبل كل إعادة جدولة وعند إغلاق الغرفة. */
function clearClue(room) {
  if (room?.clueTimer) { clearTimeout(room.clueTimer); room.clueTimer = null; }
}

/**
 * يجدول كشف التلميح التالي. كل بثّ يحمل `clueMsLeft` فيعدّ المتصفح محلياً
 * بين البثّين، ويُعاد ضبطه عند كل تلميح — فلا ينحرف عدّاده عن الخادم.
 */
function scheduleClue(room) {
  clearClue(room);
  if (room.game !== 'man-ana' || room.state.phase !== 'clues') return;
  room.clueAt = Date.now() + CLUE_MS;
  room.clueTimer = setTimeout(() => {
    room.clueTimer = null;
    if (!rooms.has(room.state.code)) return;          // أُغلقت الغرفة أثناء الانتظار
    const r = MA.advanceClue(room.state);
    if (!r.ok) return;
    // الجدولة قبل البثّ: لو بُثَّ أولاً لحمل ما تبقّى من الدورة المنقضية (صفراً)
    // فجلس عدّاد المتصفح على ٠ دورةً كاملة حتى البثّ التالي
    if (!r.exhausted) scheduleClue(room);
    broadcast(room);
    for (const sock of room.sockets.values()) {
      send(sock, 'man-ana-clue', { clue: room.state.clueIndex, exhausted: Boolean(r.exhausted) });
    }
  }, CLUE_MS);
}

/**
 * جرسُ انتهاء وقت «المزاد». يُعلن الصفر ولا يُنهي الجولة: اللعبة يدويّة،
 * فقد يمدّان الوقت أو يحكمان أو يتركانه — القرار لهما لا للخادم.
 */
function clearBell(room) {
  if (room?.bellTimer) { clearTimeout(room.bellTimer); room.bellTimer = null; }
}

function scheduleBell(room) {
  clearBell(room);
  if (room.game !== 'mazad' || !room.state.round?.timer.running) return;
  const left = MZ.timeLeft(room.state);
  if (left <= 0) return;
  room.bellTimer = setTimeout(() => {
    room.bellTimer = null;
    if (!rooms.has(room.state.code)) return;      // أُغلقت الغرفة أثناء الانتظار
    // يُجمَّد العدّاد **قبل** البثّ: لولاه بُثَّت حالةٌ تقول `running` ورصيدُها صفر،
    // فيقرأ الزرُّ «⏸ أوقف» فوق ساعةٍ واقفةٍ على 0:00 لا شيء فيها ليُوقَف.
    MZ.timerPause(room.state);
    broadcast(room);                              // ليستقرّ العدّاد على صفر عندهما
    for (const sock of room.sockets.values()) send(sock, 'mazad-bell', {});
  }, left);
}

/** يبثّ لكل لاعب لقطته هو — لا لقطة مشتركة، وإلا تسرّبت أسرار الخصم. */
function broadcast(room) {
  const engine = engineOf(room);
  // ما تبقّى من دورة التلميح يعيش في الغرفة لا في الحالة: آلة الحالات خالصة بلا وقت
  const clueMsLeft = room.game === 'man-ana' && room.clueAt && room.state.phase === 'clues'
    ? Math.max(0, room.clueAt - Date.now())
    : null;
  for (const [playerId, ws] of room.sockets) {
    const state = engine.viewFor(room.state, playerId);
    if (clueMsLeft !== null) state.clueMsLeft = clueMsLeft;
    send(ws, 'state', { state });
  }
}

const announce = (room, text, extra = {}) => {
  for (const ws of room.sockets.values()) send(ws, 'judge', { text, ...extra });
};

/* ─────────── تدفّق المحاكمة ─────────── */

async function beginTrial(room) {
  const st = room.state;

  // الحراسة قبل توليد القضية: النداء يُدفع ثمنه ولو رُفض البدء بعده
  if (room.busy) return;
  if (st.status === 'session-over') { announce(room, 'انتهت الجلسة.'); return; }
  if (st.trial && !S.isTrialOver(st)) return;
  if (!S.bothPresent(st)) { announce(room, 'ينقص لاعب.'); return; }

  room.busy = true;
  const previous = room.pastCharges ?? [];

  // القرعة مرة واحدة للجلسة: القاضي لا يتبدّل بين قضاياها
  if (!st.judgeId) {
    st.judgeId = pickJudge();
    broadcast(room);
    for (const ws of room.sockets.values()) {
      send(ws, 'judge-draw', { judges: publicJudges(), chosen: st.judgeId });
    }
    if (REVEAL_MS > 0) await new Promise((r) => setTimeout(r, REVEAL_MS));
  }

  announce(room, 'المحكمة تنعقد… القاضي ينظر في الأوراق.', { thinking: true });
  let kase;
  try {
    ({ data: kase } = await judge.generateCase(previous, st.judgeId));
  } catch (err) {
    room.busy = false;
    announce(room, `تعذّر عرض القضية: ${err.message} — أعد المحاولة.`);
    broadcast(room);
    return;
  }

  room.pastCharges = [...previous, kase.charge];
  kase.cardContent = { mathal: kase.mathal, bayt: kase.bayt };

  const started = S.startTrial(st, kase);
  room.liveTranscript = '';
  room.judging = [];
  room.busy = false;
  if (!started.ok) { announce(room, started.error); broadcast(room); return; }

  broadcast(room);
  announce(room, `القضية: ${kase.charge}`, { case: kase });
}

/**
 * يسجّل المرافعة ويتقدّم فوراً، ثم يقيّمها في الخلفية أثناء مرافعة الخصم.
 * انتظارُ القاضي هنا كان يجمّد اللعبة أربع مرات في كل محاكمة.
 */
async function handleSpeech(room, playerId, transcript) {
  const st = room.state;
  const speaker = S.currentSpeaker(st);
  if (speaker?.id !== playerId) return;

  const phase = S.currentPhase(st);
  const imposed = st.trial.imposed;

  const recorded = S.submitSpeech(st, playerId, transcript);
  if (!recorded.ok) { send(room.sockets.get(playerId), 'error', { error: recorded.error }); return; }

  room.liveTranscript = '';              // وإلا حُكم على اعتراضٍ بنصّ متحدّثٍ سابق
  broadcast(room);                       // الدور ينتقل الآن، لا بعد الحكم
  announce(room, `القاضي ينظر في ${PHASE_LABELS[phase.id]}…`, { thinking: true });

  const task = (async () => {
    try {
      const { data } = await judge.judgeSpeech({
        kase: st.trial.case,
        role: speaker.role,
        phase: phase.id,
        transcript,
        card: imposed ? { cardId: imposed.cardId, content: imposed.content } : null,
        judgeId: st.judgeId,
      });
      const card = imposed ? CARD_BY_ID[imposed.cardId] : null;
      S.applyJudgement(st, recorded.index, {
        score: data.score,
        comment: data.comment,
        cardId: imposed?.cardId ?? null,
        cardFulfilled: imposed ? data.cardFulfilled : null,
        cardDelta: imposed ? (data.cardFulfilled ? card.bonus : card.penalty) : 0,
      });
      broadcast(room);
      announce(room, data.comment, {
        score: data.score,
        cardDelta: imposed ? (data.cardFulfilled ? card.bonus : card.penalty) : 0,
        who: speaker.name,
      });
    } catch (err) {
      // درجة محايدة حتى لا تتعطّل الجلسة على عطل تقني
      S.applyJudgement(st, recorded.index, {
        score: 5, comment: `تعذّر تقييم هذه المرافعة (${err.message}) — قُدّرت بخمسٍ من عشر.`,
        cardId: imposed?.cardId ?? null, cardFulfilled: null, cardDelta: 0,
      });
      broadcast(room);
      announce(room, `تعذّر تقييم ${PHASE_LABELS[phase.id]} — قُدّرت بخمسٍ من عشر.`);
    }
  })();

  room.judging = [...(room.judging ?? []), task];

  if (S.isTrialOver(st)) await concludeTrial(room);
}

async function concludeTrial(room) {
  const st = room.state;
  if (room.busy) return;
  room.busy = true;

  // الحكم النهائي يقرأ المحضر كاملاً، فلا يصدر قبل أن تكتمل كل التقييمات
  if (S.pendingJudgements(st) > 0) {
    announce(room, 'القاضي يستكمل مطالعة المحضر…', { thinking: true });
    await Promise.allSettled(room.judging ?? []);
  }
  room.judging = [];
  const pros = S.playerByRole(st, 'prosecutor');
  const def = S.playerByRole(st, 'defender');
  const scores = { prosecutor: st.trial.scores[pros.id], defender: st.trial.scores[def.id] };
  const speeches = st.trial.speeches.filter((sp) => sp.judgement);

  announce(room, 'القاضي يتداول…', { thinking: true });

  let verdict;
  try {
    ({ data: verdict } = await judge.deliverVerdict({
      kase: st.trial.case,
      speeches,
      scores,
      names: { prosecutor: pros.name, defender: def.name },
      judgeId: st.judgeId,
    }));
  } catch (err) {
    room.busy = false;
    room.verdictFailed = true;           // تُفتح إعادة المحاولة في الواجهة
    broadcast(room);
    announce(room, `تعذّر النطق بالحكم: ${err.message} — اطلب الحكم مجدداً.`);
    return;
  }

  room.busy = false;
  room.verdictFailed = false;
  const winnerId = verdict.winner === 'prosecutor' ? pros.id : def.id;
  S.recordVerdict(st, winnerId, verdict);
  broadcast(room);
  announce(room, verdict.spoken, { verdict, speak: true });
}

async function handleObjection(room, playerId) {
  const st = room.state;
  const pending = st.trial?.pendingObjection;
  if (!pending || pending.by !== playerId) return;

  announce(room, 'اعتراض! القاضي ينظر فيه.', { thinking: true, objection: true });

  let sustained = false;
  try {
    const { data } = await judge.judgeObjection({
      kase: st.trial.case,
      transcript: room.liveTranscript ?? '',
      judgeId: st.judgeId,
    });
    sustained = data.sustained;
    S.resolveObjection(st, sustained);
    broadcast(room);
    announce(room, data.comment ?? (sustained ? 'الاعتراض مقبول.' : 'الاعتراض مرفوض.'),
      { objectionResolved: sustained });
  } catch (err) {
    // لا يُخصم على عطل تقني: تُلغى المعلّقة بلا نقاط وتُردّ البطاقة
    st.trial.pendingObjection = null;
    const card = st.players[playerId]?.hand.find((c) => c.id === 'objection');
    if (card) card.spent = false;
    broadcast(room);
    announce(room, `تعذّر الفصل في الاعتراض: ${err.message} — رُدّت البطاقة.`);
  }
}

/** يترجم رسالة «المزاد» إلى استدعاء في آلة الحالات. */
function applyMazad(room, playerId, msg) {
  const st = room.state;
  switch (msg.type) {
    case 'mazad-config': return MZ.configure(st, msg.patch ?? {});
    case 'mazad-open': {
      const r = MZ.openBidding(st, playerId, msg.amount);
      return r.ok ? { ...r, announce: 'mazad-bid' } : r;
    }
    case 'mazad-raise': {
      const r = MZ.raise(st, playerId, msg.amount);
      return r.ok ? { ...r, announce: 'mazad-bid' } : r;
    }
    case 'mazad-hand': {
      const r = MZ.handOver(st, playerId);
      return r.ok ? { ...r, announce: 'mazad-hand', extra: { challengerId: st.round.challengerId } } : r;
    }
    case 'mazad-answer': return MZ.addAnswer(st, playerId, msg.text);
    case 'mazad-remove': return MZ.removeAnswer(st, msg.index, msg.text);
    case 'mazad-clear': return MZ.clearAnswers(st);
    case 'mazad-timer':
      if (msg.action === 'start') return MZ.timerStart(st);
      if (msg.action === 'pause') return MZ.timerPause(st);
      if (msg.action === 'reset') return MZ.timerReset(st);
      if (msg.action === 'adjust') return MZ.timerAdjust(st, msg.delta);
      return { ok: false, error: 'أمر مؤقّت غير معروف' };
    case 'mazad-judge': {
      const r = MZ.judge(st, msg.done);
      return r.ok ? { ...r, announce: 'mazad-verdict', extra: { winnerId: r.winnerId, done: Boolean(msg.done) } } : r;
    }
    case 'mazad-next': return MZ.nextRound(st);
    case 'mazad-end': return MZ.endSession(st);
    default: return { ok: false, error: 'رسالة غير معروفة' };
  }
}

/* ─────────── WebSocket ─────────── */

const wss = new WebSocketServer({ server });

/**
 * سقف رسائل لكل مقبس. كل مرافعة تُنادي Claude، فالإغراق برسائل يصير فاتورة
 * لا مجرد حمل على الخادم. رسائل 'live' كثيرة بطبعها فلها سقف أوسع.
 */
const RATE = { windowMs: 10_000, max: 60, liveMax: 200 };

wss.on('connection', (ws) => {
  let room = null;
  let playerId = null;
  let windowStart = Date.now();
  let count = 0;
  let liveCount = 0;

  const overRate = (type) => {
    const now = Date.now();
    if (now - windowStart > RATE.windowMs) { windowStart = now; count = 0; liveCount = 0; }
    if (type === 'live') return ++liveCount > RATE.liveMax;
    return ++count > RATE.max;
  };

  ws.on('message', async (raw) => {
    if (raw.length > 8192) return;                  // لا رسائل ضخمة
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg?.type !== 'string') return;
    if (overRate(msg.type)) {
      send(ws, 'error', { error: 'رسائل كثيرة بسرعة — تمهّل.' });
      return;
    }

    // كل رسالة تخصّ لعبتها (انظر GAME_MESSAGES)
    const owner = GAME_OF_MESSAGE.get(msg.type);
    if (room && owner && owner !== room.game) return;

    try {
      switch (msg.type) {
        case 'create': {
          const code = freshCode();
          playerId = randomUUID();
          const game = ENGINES[msg.game] ? msg.game : 'muhakama';
          const state = ENGINES[game].createSession(code, playerId, (msg.name || 'لاعب').slice(0, 20));
          room = { state, game, sockets: new Map(), pastCharges: [] };
          room.sockets.set(playerId, ws);
          rooms.set(code, room);
          send(ws, 'joined', { playerId, code, game, judges: publicJudges() });
          broadcast(room);
          break;
        }

        case 'join': {
          const code = String(msg.code || '').toUpperCase();
          room = rooms.get(code);
          if (!room) { send(ws, 'error', { error: 'لا يوجد ديوان بهذا الرمز' }); room = null; break; }
          if (msg.game && msg.game !== room.game) {
            const label = GAME_LABELS[room.game] ?? room.game;
            send(ws, 'error', { error: `هذا الديوان يلعب «${label}» — اختر اللعبة نفسها` });
            room = null;
            break;
          }
          const name = (msg.name || 'لاعب').slice(0, 20);

          // مقعد لاعبٍ انقطع يُستعاد بنفس الاسم بدل أن يُقال "الديوان ممتلئ"
          const vacant = Object.values(room.state.players)
            .find((p) => !p.connected && !room.sockets.has(p.id));
          if (vacant) {
            playerId = vacant.id;
            vacant.connected = true;
            vacant.name = name;
          } else {
            playerId = randomUUID();
            const added = engineOf(room).addPlayer(room.state, playerId, name);
            if (!added.ok) { send(ws, 'error', { error: added.error }); room = null; break; }
          }
          room.sockets.set(playerId, ws);
          send(ws, 'joined', { playerId, code, game: room.game, judges: publicJudges() });
          broadcast(room);
          // سجلّ القاضي للمحاكمة وحدها — غيرها لا لوح فيه يعرض النداء
          if (room.game === 'muhakama') announce(room, 'اكتمل الخصمان. ارفعوا الجلسة متى شئتم.');
          break;
        }

        case 'start-trial':
          if (room && S.bothPresent(room.state)) await beginTrial(room);
          break;

        case 'advance':                       // انتهاء عرض القضية
          if (room && S.advancePhase(room.state).ok) broadcast(room);
          break;

        case 'play-card': {
          if (!room) break;
          if (room.busy) {          // القاضي ينظر — رمية الآن تُصرف بلا أثر
            send(ws, 'error', { error: 'القاضي ينظر — أمهله لحظة' });
            break;
          }
          const r = S.playCard(room.state, playerId, msg.cardId);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }

          broadcast(room);
          const card = CARD_BY_ID[msg.cardId];
          const thrower = room.state.players[playerId];
          for (const [pid, sock] of room.sockets) {
            send(sock, 'weapon-thrown', {
              cardId: msg.cardId,
              name: card.name,
              // الاعتراض لا يفرض قيداً، فنصّه دعوةُ القاضي لا مطلبٌ من الخصم
              onTarget: card.onTarget ?? 'قُوطعت المرافعة — القاضي ينظر في الاعتراض',
              content: room.state.trial?.imposed?.content ?? null,
              by: thrower?.name ?? '',
              atMe: pid === r.target,          // الهدف يرى انميشناً مختلفاً
            });
          }

          if (room.state.trial?.pendingObjection?.by === playerId) await handleObjection(room, playerId);
          break;
        }

        case 'live':                          // نص جارٍ، يُستخدم للفصل في الاعتراض
          if (room) room.liveTranscript = String(msg.transcript || '').slice(0, 4000);
          break;

        case 'speech':
          if (room) await handleSpeech(room, playerId, String(msg.transcript || '').slice(0, 4000));
          break;

        case 'retry-verdict':
          if (room && room.state.trial && !room.state.trial.verdict) await concludeTrial(room);
          break;

        /* ─── سَنَد ─── */

        case 'sanad-start': {
          if (room?.game !== 'sanad') break;
          const r = SN.startSession(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }
          broadcast(room);
          break;
        }

        case 'sanad-choose': {
          if (room?.game !== 'sanad') break;
          const r = SN.choose(room.state, playerId, msg.kind);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }
          broadcast(room);
          for (const sock of room.sockets.values()) send(sock, 'sanad-told', {});
          break;
        }

        case 'sanad-rule': {
          if (room?.game !== 'sanad') break;
          const r = SN.rule(room.state, playerId, msg.ruling);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }
          broadcast(room);
          for (const [pid, sock] of room.sockets) {
            send(sock, 'sanad-verdict', { iWon: pid === r.winnerId, listenerRight: r.listenerRight });
          }
          break;
        }

        case 'sanad-next': {
          if (room?.game !== 'sanad') break;
          const r = SN.next(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }
          broadcast(room);
          break;
        }

        /* ─── معاني ─── */

        case 'maani-start': {
          if (room?.game !== 'maani') break;
          const r = MN.startSession(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          broadcast(room);
          break;
        }

        /**
         * سباق: أول جوابٍ صحيح يُغلق السؤال. البثّ بعد كل إجابة — فمن أخطأ
         * يُقفل عليه فوراً، وخصمه يرى أن الميدان خلا له.
         */
        case 'maani-answer': {
          if (room?.game !== 'maani') break;
          const r = MN.answer(room.state, playerId, msg.choice);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          broadcast(room);
          for (const [pid, sock] of room.sockets) {
            send(sock, 'maani-result', {
              mine: pid === playerId,
              correct: r.correct,
              resolved: r.resolved,
              winnerId: room.state.roundWinnerId,
            });
          }
          break;
        }

        case 'maani-next': {
          if (room?.game !== 'maani') break;
          const r = MN.next(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          broadcast(room);
          break;
        }

        /* ─── من أنا ─── */

        case 'man-ana-start': {
          if (room?.game !== 'man-ana') break;
          const r = MA.startSession(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          scheduleClue(room);          // قبل البثّ ليحمل ما تبقّى من الدورة صحيحاً
          broadcast(room);
          break;
        }

        /**
         * تخمين: الإصابة تُنهي الشخصية وتوقف المؤقّت، والخطأ يُقفل صاحبه
         * حتى التلميح التالي — فيبقى المؤقّت يجري كما هو.
         */
        case 'man-ana-guess': {
          if (room?.game !== 'man-ana') break;
          const r = MA.guess(room.state, playerId, msg.text);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          if (r.solved) clearClue(room);
          broadcast(room);
          for (const [pid, sock] of room.sockets) {
            send(sock, 'man-ana-result', {
              mine: pid === playerId,
              correct: r.correct,
              solved: Boolean(r.solved),
              points: r.points ?? 0,
            });
          }
          break;
        }

        case 'man-ana-next': {
          if (room?.game !== 'man-ana') break;
          const r = MA.next(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          scheduleClue(room);          // لا تجدول شيئاً إن انتهت الجلسة (تُفحص بالداخل)
          broadcast(room);
          break;
        }

        /* ─── المزاد ─── */

        case 'mazad-start': {
          if (room?.game !== 'mazad') break;
          const r = MZ.startSession(room.state);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }
          broadcast(room);
          break;
        }

        /**
         * كل أدوات الجولة. **أيّ اللاعبَين** يستعملها — لعبة يدويّة بالاتفاق،
         * والحارس الوحيد هو دور المزايدة داخل آلة الحالات نفسها.
         */
        case 'mazad-config': case 'mazad-open': case 'mazad-raise': case 'mazad-hand':
        case 'mazad-answer': case 'mazad-remove': case 'mazad-clear': case 'mazad-timer':
        case 'mazad-judge': case 'mazad-next': case 'mazad-end': {
          if (room?.game !== 'mazad') break;
          const r = applyMazad(room, playerId, msg);
          if (!r.ok) { send(ws, 'error', { error: r.error, soft: true }); break; }

          // كل ما يمسّ المؤقّت يُعيد جدولة الجرس — والحكم والانتقال يوقفانه
          scheduleBell(room);
          broadcast(room);
          if (r.announce) for (const [pid, sock] of room.sockets) {
            send(sock, r.announce, { ...r.extra, mine: pid === playerId });
          }
          break;
        }

        case 'next-trial':
          if (room && room.state.status === 'trial' && S.isTrialOver(room.state)) await beginTrial(room);
          break;
      }
    } catch (err) {
      send(ws, 'error', { error: err.message });
    }
  });

  ws.on('close', () => {
    if (!room || !playerId) return;
    room.sockets.delete(playerId);
    const player = room.state.players[playerId];
    if (player) player.connected = false;
    if (room.sockets.size === 0) {
      clearClue(room);               // مؤقّتٌ على غرفةٍ ميتة يبقى يعمل ويمنع الخروج
      clearBell(room);
      rooms.delete(room.state.code);
    } else broadcast(room);
  });
});

// رسالة مفهومة بدل كومة أخطاء Node
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  المنفذ ${PORT} مشغول — غالباً خادم قديم ما زال يعمل.`);
    console.error('  أغلق نافذته، أو شغّل على منفذ آخر:');
    console.error(`      PORT=${PORT + 1} npm start`);
    console.error('');
  } else {
    console.error(`  تعذّر تشغيل الخادم: ${err.message}`);
  }
  process.exit(1);
});

wss.on('error', () => { /* يُبلَّغ عنه من server.on('error') */ });

server.listen(PORT, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  const lan = lanAddress();

  console.log('');
  console.log('  ديوان التحدي جاهز');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  على هذا الجهاز:  ${scheme}://localhost:${PORT}`);
  if (lan) console.log(`  من جهاز آخر:     ${scheme}://${lan}:${PORT}`);
  console.log('');
  console.log(judge.hasCredentials()
    ? `  القاضي: claude-opus-5${envFileUsed ? '  (المفتاح من .env)' : ''}`
    : '  القاضي: وهمي — أضف ANTHROPIC_API_KEY في ملف .env لحكم حقيقي');

  if (!USE_HTTPS && lan) {
    console.log('');
    console.log('  ملاحظة: المايكروفون لا يعمل من جهاز آخر على http.');
    console.log('  للصوت على الجوال شغّل:  npm run https');
  }
  if (USE_HTTPS) {
    console.log('');
    console.log('  الشهادة محلية، فسيحذّر المتصفح مرة واحدة:');
    console.log('  اضغط «متقدم» ثم «متابعة» — ثم يعمل المايكروفون.');
  }
  console.log('');
});
