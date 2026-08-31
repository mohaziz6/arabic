/**
 * شاشة المحاكمة — تتصل بالخادم، تعرض اللقطة، وتلتقط المرافعات.
 * كل منطق اللعب في الخادم؛ هذا الملف عرض وإدخال فقط.
 */

import { startListening, speak, speechSupported } from './speech.js';
import { revealJudge } from './judge-reveal.js';
import { judgeSilhouette } from './judge-art.js';
import { openArmory, closeArmory, showStrike, isArmoryOpen } from './armory.js';

const $ = (s) => document.querySelector(s);

/** نصّ القضية والقيود يولّدها النموذج — لا تُحقن كـ HTML. */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let ws = null;
let view = null;
let judges = [];
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
    if (m.type === 'joined') { judges = m.judges ?? []; onJoined?.(m); }
    else if (m.type === 'judge-draw') { judges = m.judges; revealJudge(m.judges, m.chosen); }
    else if (m.type === 'weapon-thrown') showStrike(m);
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
  renderJudgeSeat(state);
  renderWeapons(state);
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
  renderVerdict(state);
}

const roleLabel = (r) => (r === 'prosecutor' ? 'المدعي العام' : 'محامي الدفاع');

/** منصّة القاضي في وسط الطاولة: صورته ولوحة اسمه. */
function renderJudgeSeat(state) {
  const j = judges.find((x) => x.id === state.judgeId);
  const seat = $('#judge-seat');
  seat.classList.toggle('seated', Boolean(j));
  if (!j) return;

  $('#judge-name').textContent = j.name;
  $('#judge-brief').textContent = j.brief;

  const portrait = $('#judge-portrait');
  if (portrait.dataset.id === j.id) return;       // لا نعيد بناء SVG بلا داعٍ
  portrait.dataset.id = j.id;
  portrait.innerHTML = judgeSilhouette(j.id);
}

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

const AR_NUM = ['٠', '١', '٢', '٣', '٤'];

/** متى يجوز الرمي؟ أثناء مرافعة الخصم فقط. */
function throwState(state) {
  const t = state.trial;
  if (!t || t.phase === 'case' || t.phase === 'verdict') {
    return { can: false, reason: 'لا مرافعة جارية' };
  }
  if (t.isMyTurn) return { can: false, reason: 'دورك أنت — السلاح يُرمى على المترافع' };
  if (t.imposed) return { can: false, reason: 'رميتَ سلاحاً في هذه المرافعة' };
  return { can: true, reason: '' };
}

function renderWeapons(state) {
  const left = state.me.hand.filter((c) => !c.spent).length;
  $('#weapons-left').textContent = `${AR_NUM[left] ?? left} أسلحة`;

  const { can, reason } = throwState(state);

  // خزانة مفتوحة بعد أن صار الدور دورك تحجب لوحة مرافعتك — تُغلق
  if (isArmoryOpen() && !can) closeArmory();

  $('#btn-weapons').classList.toggle('armed', can && left > 0);
  $('#btn-weapons').disabled = left === 0;
  $('#weapon-hint').textContent = can
    ? 'خصمك يترافع — ارمِ الآن'
    : (reason || 'تُرمى على خصمك أثناء مرافعته');

  renderImposed(state);
}

/** القيد المرمي: الهدف يراه ليصارعه، والرامي يراه ليرقبه. */
function renderImposed(state) {
  const box = $('#imposed-card');
  const im = state.trial?.imposed;
  box.hidden = !im;
  if (!im) return;

  const card = state.me.hand.find((c) => c.id === im.cardId);
  const onMe = im.on === state.me.id;
  box.classList.toggle('on-me', onMe);
  box.innerHTML = `
    <span class="imposed-tag">${onMe ? 'قيدٌ عليك' : 'قيدٌ رميتَه'}</span>
    <strong>${esc(card?.name ?? im.cardId)}</strong>
    ${im.content ? `<em>«${esc(im.content)}»</em>` : ''}`;
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
  $('#btn-weapons').addEventListener('click', () => {
    const { can, reason } = throwState(view ?? { trial: null, me: { hand: [] } });
    openArmory(view?.me?.hand ?? [], {
      canThrow: can,
      reason,
      onThrow: (cardId) => send('play-card', { cardId }),
    });
  });
  $('#btn-armory-close').addEventListener('click', closeArmory);
  $('#btn-begin').addEventListener('click', () => send('advance'));
  $('#btn-start-trial').addEventListener('click', () => send('start-trial'));
  $('#btn-next-trial').addEventListener('click', () => send('next-trial'));
  $('#btn-submit-speech').addEventListener('click', submitSpeech);
}
