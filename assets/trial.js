/**
 * شاشة المحاكمة — تتصل بالخادم، تعرض اللقطة، وتلتقط المرافعات.
 * كل منطق اللعب في الخادم؛ هذا الملف عرض وإدخال فقط.
 */

import { startListening, speak, speechSupported } from './speech.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let ws = null;
let view = null;
let mic = null;
let timer = null;
let secondsLeft = 0;

/* ─────────── الاتصال ─────────── */

export function connect({ mode, name, code, onJoined, onError }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(mode === 'create' ? { type: 'create', name } : { type: 'join', code, name }));
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'joined') onJoined?.(m);
    else if (m.type === 'state') render(m.state);
    else if (m.type === 'judge') onJudge(m);
    else if (m.type === 'error') onError?.(m.error);
  });

  ws.addEventListener('error', () => onError?.('تعذّر الاتصال بالخادم — شغّله بـ npm start.'));
  ws.addEventListener('close', () => addLine('انقطع الاتصال بالديوان.', 'sys'));
}

const send = (type, extra = {}) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, ...extra }));

export const startTrial = () => send('start-trial');

/* ─────────── العرض ─────────── */

function render(state) {
  const prev = view;
  view = state;

  $('#trial-code').textContent = state.code;
  renderInvite(state);
  $('#score-me').textContent = state.trial?.scores?.[state.me.id] ?? 0;
  $('#score-opp').textContent = state.opponent ? (state.trial?.scores?.[state.opponent.id] ?? 0) : 0;
  $('#wins-me').textContent = state.wins?.[state.me.id] ?? 0;
  $('#wins-opp').textContent = state.opponent ? (state.wins?.[state.opponent.id] ?? 0) : 0;

  $('#me-name').textContent = state.me.name;
  $('#me-role').textContent = roleLabel(state.me.role);
  $('#opp-name').textContent = state.opponent?.name ?? 'بانتظار الخصم…';
  $('#opp-role').textContent = state.opponent ? roleLabel(state.opponent.role) : '';
  $('#opp-cards').textContent = state.opponent?.cardsLeft ?? 0;
  // رصيد خصمٍ لم يصل بعد ضجيج
  $('#opp-tally').hidden = !state.opponent;

  renderCase(state);
  renderPhase(state, prev);
  renderHand(state);
  renderVerdict(state);
}

const roleLabel = (r) => (r === 'prosecutor' ? 'المدعي العام' : 'محامي الدفاع');

/** بطاقة الدعوة تظهر ما دام الخصم لم يصل. */
function renderInvite(state) {
  const box = $('#invite-box');
  box.hidden = Boolean(state.opponent);
  if (state.opponent) return;
  $('#invite-code').textContent = state.code;
  $('#invite-link').value = `${location.origin}/?code=${state.code}`;
}

export function bindInvite() {
  $('#btn-copy-link').addEventListener('click', async (e) => {
    const link = $('#invite-link').value;
    try {
      await navigator.clipboard.writeText(link);
      e.target.textContent = 'نُسخ ✓';
    } catch {
      $('#invite-link').select();          // نسخ اليد حين يمنع المتصفح الحافظة
      e.target.textContent = 'انسخه يدوياً';
    }
    setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1800);
  });
}

function renderCase(state) {
  const box = $('#case-box');
  const k = state.trial?.case;
  box.hidden = !k;
  if (!k) return;
  $('#case-charge').textContent = k.charge;
  $('#case-defendant').textContent = k.defendant;
  $('#case-facts').textContent = k.facts;
  $('#btn-begin').hidden = state.trial.phase !== 'case';
}

function renderPhase(state, prev) {
  const t = state.trial;
  $('#phase-label').textContent = t ? phaseLabel(t.phase) : 'لم تبدأ المحاكمة';
  const canStart = Boolean(state.opponent) && state.status !== 'session-over' && (!t || Boolean(t.verdict));
  $('#btn-start-trial').hidden = !canStart || Boolean(t);

  const speaking = Boolean(t?.isMyTurn) && t.phase !== 'case' && t.phase !== 'verdict';
  $('#speak-panel').hidden = !speaking;
  $('#waiting-panel').hidden = speaking || !t || t.phase === 'case' || t.phase === 'verdict';

  // دخلتُ دوري للتوّ — ابدأ المؤقّت والالتقاط
  if (speaking && prev?.trial?.phase !== t.phase) beginMyTurn(t.seconds);
  if (!speaking) {
    stopTimer();
    stopMic();                       // وإلا ظلّ يبثّ live ويسمّم اعتراض الخصم
    $('#timer').textContent = '—';   // وإلا بقي معلقاً برقم دورٍ انتهى
  }

  $('#objection-banner').hidden = !t?.pendingObjection;
}

const PHASE_LABELS = {
  'case': 'عرض القضية',
  'opening-pros': 'مرافعة الادعاء',
  'opening-def': 'مرافعة الدفاع',
  'rebuttal-pros': 'ردّ الادعاء',
  'rebuttal-def': 'ردّ الدفاع',
  'verdict': 'الحكم',
};
const phaseLabel = (p) => PHASE_LABELS[p] ?? '—';

function renderHand(state) {
  const wrap = $('#hand');
  wrap.innerHTML = '';
  const t = state.trial;

  for (const card of state.me.hand) {
    const btn = el('button', 'play-card');
    btn.type = 'button';
    btn.disabled = card.spent || !t || t.phase === 'case' || t.phase === 'verdict';
    if (card.spent) btn.classList.add('spent');

    btn.append(el('span', 'play-card-glyph', card.glyph));
    const body = el('div', 'play-card-body');
    body.append(el('strong', null, card.name));
    body.append(el('small', null, card.content || card.brief));
    btn.append(body);

    btn.addEventListener('click', () => send('play-card', { cardId: card.id }));
    wrap.append(btn);
  }
}

function renderVerdict(state) {
  const box = $('#verdict-box');
  const v = state.trial?.verdict;
  box.hidden = !v;
  if (!v) return;
  $('#verdict-spoken').textContent = v.spoken;
  $('#verdict-reasoning').textContent = v.reasoning;

  const over = state.status === 'session-over';
  $('#btn-next-trial').hidden = over;
  $('#session-result').hidden = !over;
  if (over) {
    $('#session-result').textContent = state.winnerId
      ? (state.winnerId === state.me.id ? 'فزتَ بالجلسة 🏆' : 'خسرتَ الجلسة')
      : 'انتهت الجلسة بالتعادل';
  }
}

/* ─────────── دوري في المرافعة ─────────── */

function beginMyTurn(seconds) {
  $('#transcript').value = '';
  $('#mic-state').textContent = speechSupported() ? 'يستمع…' : 'اكتب مرافعتك';

  if (speechSupported()) {
    mic = startListening({
      onUpdate: (live) => {
        $('#transcript').value = live;
        send('live', { transcript: live });
      },
      onError: (e) => { $('#mic-state').textContent = e; },
    });
  }
  startTimer(seconds);
}

function startTimer(seconds) {
  stopTimer();
  secondsLeft = seconds;
  $('#timer').textContent = secondsLeft;
  timer = setInterval(() => {
    // الاعتراض يوقف المؤقّت — وإلا صار سرقة وقت لا حجة
    if (view?.trial?.pendingObjection) return;
    secondsLeft -= 1;
    $('#timer').textContent = Math.max(0, secondsLeft);
    if (secondsLeft <= 0) submitSpeech();
  }, 1000);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}

function stopMic() {
  const text = mic?.stop() ?? null;
  mic = null;
  return text;
}

/**
 * يرسل المرافعة. اللاعب يرى نصه المحوَّل ويصحّحه قبل الإرسال —
 * بدونها يحكم القاضي على كلام لم يُقَل، ويبدو ظالماً واللاعب محق.
 */
function submitSpeech() {
  stopTimer();
  stopMic();
  const text = $('#transcript').value.trim();
  $('#speak-panel').hidden = true;
  send('speech', { transcript: text });
}

/* ─────────── سجل القاضي ─────────── */

function onJudge(m) {
  if (m.thinking) { addLine(m.text, 'thinking'); return; }
  addLine(m.text, m.verdict ? 'verdict' : 'say', m);
  if (m.speak) speak(m.text);
}

function addLine(text, kind, extra = {}) {
  const log = $('#judge-log');
  log.hidden = false;
  // رسالة "ينظر…" مؤقتة تُستبدل بالتالية
  if (kind !== 'thinking') log.querySelector('.thinking')?.remove();

  const line = el('div', `judge-line ${kind}`);
  line.append(el('div', 'judge-text', text));

  if (typeof extra.score === 'number') {
    const marks = el('div', 'judge-marks');
    marks.append(el('span', 'mark', `${extra.score}/١٠`));
    if (extra.cardDelta) {
      marks.append(el('span', `mark ${extra.cardDelta > 0 ? 'plus' : 'minus'}`,
        `${extra.cardDelta > 0 ? '+' : ''}${extra.cardDelta} بطاقة`));
    }
    line.append(marks);
  }
  log.append(line);
  log.scrollTop = log.scrollHeight;
}

/* ─────────── الربط ─────────── */

export function bindTrialUI() {
  bindInvite();
  $('#btn-begin').addEventListener('click', () => send('advance'));
  $('#btn-start-trial').addEventListener('click', () => send('start-trial'));
  $('#btn-next-trial').addEventListener('click', () => send('next-trial'));
  $('#btn-submit-speech').addEventListener('click', submitSpeech);
}
