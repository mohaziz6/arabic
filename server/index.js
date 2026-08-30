/**
 * خادم ديوان التحدي — يخدم الملفات الثابتة، ويدير الغرف، وينادي القاضي.
 *
 * المفتاح لا يغادر هنا أبداً، وكذلك البطاقات والدرجات: المتصفح لا يرى
 * إلا لقطة viewFor الخاصة به.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import * as S from './state.js';
import * as judge from './judge.js';
import { CARD_BY_ID } from './rules.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 8000;

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = resolvePublic(url.pathname);
  if (!file) { res.writeHead(404).end('not found'); return; }

  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] });
    res.end(body);
  });
});

/* ─────────── الغرف ─────────── */

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

/** يبثّ لكل لاعب لقطته هو — لا لقطة مشتركة، وإلا تسرّبت بطاقات الخصم. */
function broadcast(room) {
  for (const [playerId, ws] of room.sockets) {
    send(ws, 'state', { state: S.viewFor(room.state, playerId) });
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

  announce(room, 'المحكمة تنعقد… القاضي ينظر في الأوراق.', { thinking: true });
  let kase;
  try {
    ({ data: kase } = await judge.generateCase(previous));
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
  room.busy = false;
  if (!started.ok) { announce(room, started.error); broadcast(room); return; }

  broadcast(room);
  announce(room, `القضية: ${kase.charge}`, { case: kase });
}

async function handleSpeech(room, playerId, transcript) {
  const st = room.state;
  const speaker = S.currentSpeaker(st);
  if (speaker?.id !== playerId) return;
  if (room.busy) return;                 // مرافعة قيد التقييم — لا تُقيَّم مرتين
  room.busy = true;

  const phase = S.currentPhase(st);
  const played = st.trial.playedThisPhase;

  announce(room, 'القاضي ينظر في المرافعة…', { thinking: true });

  let judgement;
  try {
    const { data } = await judge.judgeSpeech({
      kase: st.trial.case,
      role: speaker.role,
      phase: phase.id,
      transcript,
      card: played ? { cardId: played.cardId, content: played.content } : null,
    });
    const card = played ? CARD_BY_ID[played.cardId] : null;
    judgement = {
      score: data.score,
      comment: data.comment,
      cardId: played?.cardId ?? null,
      cardFulfilled: played ? data.cardFulfilled : null,
      cardDelta: played ? (data.cardFulfilled ? card.bonus : card.penalty) : 0,
    };
  } catch (err) {
    room.busy = false;
    // أعد بثّ الحالة وإلا بقي المترافع عالقاً بلا لوحة ولا مؤقّت
    broadcast(room);
    announce(room, `تعذّر تقييم المرافعة: ${err.message} — أعد إرسالها.`);
    return;
  }

  const recorded = S.submitSpeech(st, playerId, transcript, judgement);
  room.busy = false;
  room.liveTranscript = '';              // وإلا حُكم على اعتراضٍ بنصّ متحدّثٍ سابق
  if (!recorded.ok) { broadcast(room); return; }

  broadcast(room);
  announce(room, judgement.comment, { score: judgement.score, cardDelta: judgement.cardDelta });

  if (S.isTrialOver(st)) await concludeTrial(room);
}

async function concludeTrial(room) {
  const st = room.state;
  if (room.busy) return;
  room.busy = true;
  const pros = S.playerByRole(st, 'prosecutor');
  const def = S.playerByRole(st, 'defender');
  const scores = { prosecutor: st.trial.scores[pros.id], defender: st.trial.scores[def.id] };

  announce(room, 'القاضي يتداول…', { thinking: true });

  let verdict;
  try {
    ({ data: verdict } = await judge.deliverVerdict({
      kase: st.trial.case,
      speeches: st.trial.speeches,
      scores,
      names: { prosecutor: pros.name, defender: def.name },
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

    try {
      switch (msg.type) {
        case 'create': {
          const code = freshCode();
          playerId = randomUUID();
          const state = S.createSession(code, playerId, (msg.name || 'لاعب').slice(0, 20));
          room = { state, sockets: new Map(), pastCharges: [] };
          room.sockets.set(playerId, ws);
          rooms.set(code, room);
          send(ws, 'joined', { playerId, code });
          broadcast(room);
          break;
        }

        case 'join': {
          const code = String(msg.code || '').toUpperCase();
          room = rooms.get(code);
          if (!room) { send(ws, 'error', { error: 'لا يوجد ديوان بهذا الرمز' }); room = null; break; }
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
            const added = S.addPlayer(room.state, playerId, name);
            if (!added.ok) { send(ws, 'error', { error: added.error }); room = null; break; }
          }
          room.sockets.set(playerId, ws);
          send(ws, 'joined', { playerId, code });
          broadcast(room);
          announce(room, 'اكتمل الخصمان. ارفعوا الجلسة متى شئتم.');
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
          const r = S.playCard(room.state, playerId, msg.cardId);
          if (!r.ok) { send(ws, 'error', { error: r.error }); break; }
          broadcast(room);
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
    if (room.sockets.size === 0) rooms.delete(room.state.code);
    else broadcast(room);
  });
});

server.listen(PORT, () => {
  console.log(`ديوان التحدي على http://localhost:${PORT}`);
  console.log(judge.hasCredentials()
    ? 'القاضي: claude-opus-5'
    : 'القاضي: وهمي (ANTHROPIC_API_KEY غير مضبوط)');
});
