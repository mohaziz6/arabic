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
          send(ws, 'joined', { playerId, code, judges: publicJudges() });
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
          send(ws, 'joined', { playerId, code, judges: publicJudges() });
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
