/**
 * شاشة «المزاد» — لعبة يدويّة: كل شيء يكتبه اللاعبان ويضبطانه ويحكمان به.
 *
 * لا بنك أسئلة ولا وكيل ولا جواب صحيح في الخادم. الشاشة لوحُ مزادٍ ومؤقّتٌ
 * ومسجّل إجابات، **وكلا اللاعبَين يملك كل زرّ** إلا دور المزايدة.
 *
 * المايك يقطّع ما يُقال عند الوقفات إلى شاراتٍ مرقّمة تُعدّ أمام الرقم المطلوب،
 * ومعه حقل كتابة لمن لا يعمل مايكه — فلا تتعطّل اللعبة على متصفح.
 */

import { startListening, speechSupported } from './speech.js';

const $ = (s) => document.querySelector(s);

/** كل ما يكتبه اللاعبان بيانات لا HTML. */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** يُظهر عنصراً بانتقاله — بإعادة تدفّق لا بـ rAF (لا يعمل في تبويب خلفي). */
function reveal(el) {
  if (!el) return;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('shown');
}

function hide(el) {
  if (!el) return;
  el.hidden = true;
  el.classList.remove('shown');
}

const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n) => String(n).split('').map((d) => AR[+d] ?? d).join('');
const points = (n) => (n === 1 ? 'نقطة' : n === 2 ? 'نقطتان' : `${arNum(n)} نقاط`);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** العدّاد يُقرأ تحت ضغط: أرقام لاتينية معزولة أوضح من العربية-الهندية. */
const clock = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/* ─────────── الصوت (مولَّد، بلا ملفات) ─────────── */

let audio = null;
function tone({ freq, dur, type = 'sine', gain = 0.09, slideTo, delay = 0 }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audio) audio = new AC();
  if (audio.state === 'suspended') audio.resume();
  const at = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  vol.gain.setValueAtTime(gain, at);
  vol.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(vol).connect(audio.destination);
  osc.start(at);
  osc.stop(at + dur);
}

const sfx = {
  bid: () => { tone({ freq: 420, slideTo: 620, dur: 0.14, type: 'triangle', gain: 0.09 });
               tone({ freq: 780, dur: 0.18, gain: 0.05, delay: 0.08 }); },
  hand: () => { tone({ freq: 300, slideTo: 180, dur: 0.3, type: 'triangle', gain: 0.1 });
                tone({ freq: 520, dur: 0.26, gain: 0.06, delay: 0.16 }); },
  chip: () => tone({ freq: 880, slideTo: 1120, dur: 0.07, type: 'triangle', gain: 0.055 }),
  tick: () => tone({ freq: 1000, slideTo: 760, dur: 0.04, type: 'square', gain: 0.045 }),
  bell: () => { [660, 520, 400].forEach((f, i) =>
                  tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.1, delay: i * 0.16 })); },
  win: () => { tone({ freq: 660, slideTo: 990, dur: 0.2, gain: 0.12 });
               tone({ freq: 990, slideTo: 1320, dur: 0.32, gain: 0.09, delay: 0.12 }); },
  lose: () => { tone({ freq: 240, slideTo: 110, dur: 0.3, type: 'sawtooth', gain: 0.1 });
                tone({ freq: 150, slideTo: 80, dur: 0.34, gain: 0.07, delay: 0.14 }); },
};

/* ─────────── الاتصال ─────────── */

let ws = null;
let view = null;

export function connect({ mode, name, code, onJoined, onError }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(mode === 'create'
      ? { type: 'create', game: 'mazad', name }
      : { type: 'join', game: 'mazad', code, name }));
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'joined') onJoined?.(m);
    else if (m.type === 'state') render(m.state);
    else if (m.type === 'mazad-bid') { sfx.bid(); bumpBid(); }
    else if (m.type === 'mazad-hand') { sfx.hand(); }
    else if (m.type === 'mazad-bell') { sfx.bell(); flashTimer(); }
    else if (m.type === 'mazad-verdict') sfx[m.winnerId === view?.me?.id ? 'win' : 'lose']();
    // رفضٌ لينٌ = تزاحم طبيعي على أدوات مشتركة: لا تنبيه حاجباً، لكن **لا صمتاً**
    // أيضاً — لعبةٌ كلُّ أدواتها بيد الاثنين لا يجوز أن تبتلع ضغطةً بلا خبر.
    else if (m.type === 'error' && m.soft) showNote(m.error);
    else if (m.type === 'error') onError?.(m.error);
  });

  ws.addEventListener('error', () => onError?.('تعذّر الاتصال بالخادم.'));
}

const send = (type, extra = {}) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, ...extra }));

/** ملاحظةٌ عابرة أعلى اللوح — تشرح رفضاً بلا أن تحجب الشاشة. */
let noteTimer = null;
function showNote(text) {
  const el = $('#mz-note');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  void el.offsetWidth;                 // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
  el.classList.add('is-on');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    el.classList.remove('is-on');
    el.hidden = true;
  }, 2600);
}

/* ─────────── حركات قصيرة ─────────── */

/** بطاقة المزايدة تقفز إلى المنتصف مع كل رقم جديد. */
function bumpBid() {
  const el = $('#mz-bid-card');
  if (!el || reducedMotion()) return;
  el.classList.remove('bump');
  void el.offsetWidth;                 // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
  el.classList.add('bump');
  el.addEventListener('animationend', () => el.classList.remove('bump'), { once: true });
}

function flashTimer() {
  const el = $('#mz-clock');
  if (!el || reducedMotion()) return;
  el.classList.remove('rang');
  void el.offsetWidth;
  el.classList.add('rang');
  el.addEventListener('animationend', () => el.classList.remove('rang'), { once: true });
}

/* ─────────── العرض ─────────── */

/** حقلٌ يكتب فيه صاحبه الآن لا يُكتب فوقه ببثٍّ حامل نصّه القديم. */
const setField = (el, value) => {
  if (el && document.activeElement !== el && el.value !== String(value)) el.value = value;
};

function render(s) {
  const prev = view;
  view = s;

  $('#mazad-code').textContent = s.code;
  $('#mz-me').textContent = s.me?.name ?? '—';
  $('#mz-opp').textContent = s.opponent?.name ?? 'بانتظار الخصم…';
  paintScores(s, { animate: s.phase === 'judged' && prev?.phase !== 'judged' });

  const invite = $('#mz-invite');
  invite.hidden = Boolean(s.opponent);
  if (!s.opponent) $('#mz-invite-link').value = `${location.origin}/?code=${s.code}&game=mazad`;
  $('#mz-start').hidden = !(s.status === 'lobby' && s.opponent);

  if (s.status === 'over') return renderOver(s);
  $('#mz-over').hidden = true;

  if (s.status !== 'round' || !s.round) {
    for (const id of ['#mz-deck', '#mz-setup', '#mz-bidding', '#mz-challenge', '#mz-judged']) hide($(id));
    $('#mz-round-no').textContent = s.opponent ? 'جاهزون' : 'بانتظار الخصم';
    stopTicker();
    return;
  }

  $('#mz-round-no').textContent = `الجولة ${arNum(s.roundNo)}`;
  reveal($('#mz-deck'));
  renderTimer(s);
  renderSetup(s);
  renderBidding(s, prev);
  renderChallenge(s, prev);
  renderJudged(s, prev);
}

/* ── المؤقّت: أعلى المنتصف، وكل شيء فيه قابل للتعديل ── */

function renderTimer(s) {
  const t = s.round.timer;
  $('#mz-clock').textContent = clock(t.leftMs);
  $('#mz-clock').classList.toggle('running', t.running);
  $('#mz-clock').classList.toggle('done', t.leftMs <= 0);
  $('#mz-play').textContent = t.running ? '⏸ أوقف' : '▶ ابدأ';
  // العدّاد لا ينطلق إلا في التحدي (آلة الحالات)، فلا يبقى الزرّ ظاهراً يُضغَط بلا أثر
  const canRun = s.phase === 'challenge';
  $('#mz-play').disabled = !canRun;
  $('#mz-play').title = canRun ? '' : 'العدّاد ينطلق بعد تسليم التحدي';
  setField($('#mz-seconds'), s.round.seconds);
  setField($('#mz-points'), s.round.points);
  $('#mz-points-label').textContent = points(s.round.points);

  if (t.running) startTicker(t.leftMs);
  else stopTicker();
}

/** العدّ محلي بين البثّين — بالوقت لا بـ rAF (لا يعمل في تبويب خلفي). */
let ticker = null;
let endsAt = 0;

function startTicker(leftMs) {
  const target = Date.now() + leftMs;
  if (ticker && Math.abs(target - endsAt) < 400) return;   // بثٌّ لا يغيّر شيئاً
  stopTicker();
  endsAt = target;
  paintClock();
  ticker = setInterval(paintClock, 200);
}

function paintClock() {
  const left = Math.max(0, endsAt - Date.now());
  const el = $('#mz-clock');
  const secs = Math.ceil(left / 1000);
  const was = Number(el.dataset.s || '-1');
  el.textContent = clock(left);
  el.dataset.s = String(secs);
  el.classList.toggle('urgent', secs <= 5 && secs > 0);
  if (secs <= 5 && secs > 0 && secs !== was) sfx.tick();
  if (left <= 0) stopTicker();
}

function stopTicker() {
  if (ticker) { clearInterval(ticker); ticker = null; }
  $('#mz-clock')?.classList.remove('urgent');
}

/* ── الإعداد: الشرط يُكتب ويراه الطرفان حياً ── */

function renderSetup(s) {
  const box = $('#mz-setup');
  if (s.phase !== 'setup') { hide(box); return; }
  setField($('#mz-text'), s.round.text);
  $('#mz-open').disabled = !s.round.text;
  reveal(box);
}

/* ── المزايدة: الرقم في المنتصف، والدور يتناوب ── */

function renderBidding(s, prev) {
  const box = $('#mz-bidding');
  const r = s.round;
  const live = s.phase === 'bidding';
  if (!live && s.phase !== 'challenge' && s.phase !== 'judged') { hide(box); return; }

  $('#mz-headline').textContent = r.text || '—';
  $('#mz-bid-num').textContent = String(r.bid || 0);   // لاتيني: «٥» حلقةٌ تُقرأ صفراً
  $('#mz-raises').textContent = r.raises
    ? `${arNum(r.raises)} ${r.raises === 1 ? 'مزايدة' : 'مزايدات'}`
    : 'لم يزايد أحد بعد';

  const nameOf = (id) => (id === s.me?.id ? s.me.name : s.opponent?.name ?? '—');
  $('#mz-bidder').textContent = r.bidderId ? `آخر مزايدة: ${nameOf(r.bidderId)}` : '';

  $('#mz-bid-log').innerHTML = r.bids
    .map((b) => `<span class="mz-bid-step${b.playerId === s.me?.id ? ' mine' : ''}">
        <b>${esc(nameOf(b.playerId))}</b> <i class="mz-bid-amt">${b.amount}</i></span>`)
    .join('');

  // أزرار المزايدة لصاحب الدور وحده — وهو الحارس الوحيد في لعبةٍ كلُّها مشترك
  const controls = $('#mz-bid-controls');
  controls.hidden = !live;
  $('#mz-turn-note').textContent = !live ? ''
    : r.myTurn ? 'دورك: زايد أو سلّمها له' : `دور ${s.opponent?.name ?? 'خصمك'}…`;
  $('#mz-turn-note').classList.toggle('mine', Boolean(r.myTurn));
  if (live) {
    $('#mz-raise').disabled = !r.myTurn;
    $('#mz-hand').disabled = !r.myTurn;
    $('#mz-raise-amount').disabled = !r.myTurn;
    if (document.activeElement !== $('#mz-raise-amount') && prev?.round?.bid !== r.bid) {
      $('#mz-raise-amount').value = r.bid + 1;
    }
  }

  const card = $('#mz-bid-card');
  card.classList.toggle('settled', s.phase !== 'bidding');
  reveal(box);
}

/* ── التحدي: الإجابات بالأسفل مع المايك ── */

function renderChallenge(s, prev) {
  const box = $('#mz-challenge');
  if (s.phase !== 'challenge' && s.phase !== 'judged') { hide(box); stopMic(); return; }

  const r = s.round;
  const who = r.iChallenge ? 'أنت' : (s.opponent?.name ?? 'خصمك');
  $('#mz-challenger').innerHTML =
    `<b>${esc(who)}</b> يجيب — المطلوب <i class="mz-bid-amt">${r.bid}</i>`;
  $('#mz-count').textContent = `${arNum(r.answers.length)} من ${arNum(r.bid)}`;
  $('#mz-count').classList.toggle('enough', r.answers.length >= r.bid);

  const grew = (prev?.round?.answers?.length ?? 0) < r.answers.length;
  renderAnswers(s, grew);

  const judging = s.phase === 'challenge';
  $('#mz-answer-tools').hidden = !judging;
  $('#mz-judge-row').hidden = !judging;
  if (!judging) stopMic();

  reveal(box);
}

function renderAnswers(s, grew) {
  const wrap = $('#mz-answers');
  const r = s.round;
  const sig = r.answers.map((a) => a.text).join('\u0000');
  if (wrap.dataset.sig === sig) return;
  wrap.dataset.sig = sig;

  if (!r.answers.length) {
    wrap.innerHTML = '<p class="mz-empty">لا إجابات بعد — تكلّم أو اكتب</p>';
    return;
  }
  wrap.innerHTML = r.answers
    .map((a, i) => `<span class="mz-chip" data-i="${i}">
        <i>${arNum(i + 1)}</i>${esc(a.text)}
        <button type="button" class="mz-chip-x" data-i="${i}" data-text="${esc(a.text)}" aria-label="احذف">✕</button>
      </span>`)
    .join('');

  if (grew) {
    wrap.lastElementChild?.classList.add('fresh');
    sfx.chip();
  }
}

/* ── الحكم ── */

function renderJudged(s, prev) {
  const box = $('#mz-judged');
  if (s.phase !== 'judged') { hide(box); return; }
  const fresh = prev?.phase !== 'judged';
  const r = s.round;
  const mine = r.earnedBy === s.me?.id;

  $('#mz-verdict-mark').textContent = r.done ? '✓' : '✕';
  $('#mz-verdict-mark').className = `mz-verdict-mark ${r.done ? 'done' : 'failed'}`;
  $('#mz-verdict-line').textContent = r.done
    ? `أتمّها — ${arNum(r.answers.length)} من ${arNum(r.bid)}`
    : `عجز عنها — ${arNum(r.answers.length)} من ${arNum(r.bid)}`;
  $('#mz-verdict-gain').textContent = `${mine ? 'لك' : 'له'} ${points(r.earned)}`;
  $('#mz-verdict-gain').classList.toggle('mine', mine);
  reveal(box);

  // الحكم يستقرّ أسفل لوحٍ طويل (مؤقّت + مزايدة + إجاباتٌ قد تبلغ الستين)، فيقع
  // خارج الشاشة فيظنّ اللاعبُ أن ضغطته ضاعت. نجرّه إليه عند دخول الطور وحده.
  if (fresh) box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
}

/* ── لوح النقاط ── */

const shownScores = {};
let scoreTimers = [];
const laterCancellable = (fn, ms) => { scoreTimers.push(setTimeout(fn, ms)); };

function cancelScoreAnim() {
  scoreTimers.forEach(clearTimeout);
  scoreTimers = [];
  document.querySelectorAll('.point-token').forEach((t) => t.remove());
}

function paintScores(s, { animate = false } = {}) {
  cancelScoreAnim();
  for (const [sel, id] of [['#mz-me-score', s.me?.id], ['#mz-opp-score', s.opponent?.id]]) {
    if (!id) continue;
    const target = s.scores[id] ?? 0;
    const known = Object.prototype.hasOwnProperty.call(shownScores, id);
    const from = known ? shownScores[id] : target;   // أول رسم لا يُحرَّك من صفر
    const node = $(sel);

    if (!animate || !known || target === from || reducedMotion()) {
      shownScores[id] = target;
      node.textContent = String(target);
      continue;
    }
    laterCancellable(() => flyThenCount(node, from, target, id), 280);
  }
}

function flyThenCount(node, from, to, id) {
  const src = $('#mz-verdict-gain');
  const a = src.getBoundingClientRect();
  const b = node.getBoundingClientRect();

  const token = document.createElement('div');
  token.className = 'point-token';
  token.textContent = `+${to - from}`;
  token.style.left = `${a.left + a.width / 2}px`;
  token.style.top = `${a.top + a.height / 2}px`;
  document.body.append(token);

  void token.offsetWidth;
  // -50% تبقى في المعادلة: بدونها يقفز الرمز بنصف حجمه ويحطّ بزاويته لا بمركزه
  token.style.transform =
    `translate(calc(-50% + ${b.left + b.width / 2 - (a.left + a.width / 2)}px), ` +
    `calc(-50% + ${b.top + b.height / 2 - (a.top + a.height / 2)}px)) scale(0.55)`;
  token.style.opacity = '0.15';

  laterCancellable(() => {
    token.remove();
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
    countUp(node, from, to, id);
  }, 620);
}

/** يعدّ الرقم تصاعدياً بالوقت لا بـ rAF (الأخير لا يعمل في تبويب خلفي). */
function countUp(node, from, to, id, { cancellable = true } = {}) {
  const started = Date.now();
  const dur = 520;
  const later = cancellable ? laterCancellable : ((fn, ms) => setTimeout(fn, ms));
  const step = () => {
    const t = Math.min(1, (Date.now() - started) / dur);
    const value = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    node.textContent = String(value);
    shownScores[id] = value;
    if (t < 1) later(step, 40);
    else { shownScores[id] = to; node.textContent = String(to); }
  };
  step();
}

/* ── الختام ── */

let finaleShown = false;

const FINALE = {
  win: { mark: '✦', title: 'أنت صاحب المزاد', line: 'زايدتَ فأوفيتَ، وسلّمتَ فأصبت.' },
  lose: { mark: '✕', title: 'غلبك خصمك', line: 'زايدتَ فوق ما تحفظ.' },
  tie: { mark: '=', title: 'تعادلتما', line: 'كلاكما عرف حدّ نفسه.' },
};

function renderOver(s) {
  for (const id of ['#mz-deck', '#mz-setup', '#mz-bidding', '#mz-challenge', '#mz-judged']) hide($(id));
  stopTicker();
  stopMic();
  const me = s.scores[s.me.id] ?? 0;
  const opp = s.scores[s.opponent?.id] ?? 0;
  const outcome = s.winnerId === null ? 'tie' : (s.winnerId === s.me.id ? 'win' : 'lose');

  $('#mz-over-title').textContent = FINALE[outcome].title;
  $('#mz-over-score').textContent =
    `${s.me.name}: ${me} — ${s.opponent?.name ?? ''}: ${opp} · ${arNum(s.rounds)} جولة`;
  reveal($('#mz-over'));

  if (!finaleShown) { finaleShown = true; playFinale(s, outcome, me, opp); }
}

/** مشهد الختام — الطبقة نفسها المشتركة بين ألعاب الديوان. */
function playFinale(s, outcome, me, opp) {
  const box = $('#finale');
  const f = FINALE[outcome];

  $('#finale-mark').textContent = f.mark;
  $('#finale-title').textContent = f.title;
  $('#finale-line').textContent = f.line;
  $('#finale-me-name').textContent = s.me.name;
  $('#finale-opp-name').textContent = s.opponent?.name ?? '';
  $('#finale-me').textContent = '0';
  $('#finale-opp').textContent = '0';
  box.className = `finale ${outcome}`;

  box.hidden = false;
  void box.offsetWidth;                 // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
  box.classList.add('is-open');

  if (reducedMotion()) {
    box.classList.add('sealed');
    $('#finale-me').textContent = String(me);
    $('#finale-opp').textContent = String(opp);
    return;
  }
  setTimeout(() => {
    box.classList.add('sealed');
    if (outcome === 'lose') sfx.lose(); else sfx.win();
  }, 320);
  // غير قابلة للإلغاء: بثٌّ يصل أثناءها كان يجمّد الحصيلة على رقم ناقص
  setTimeout(() => {
    countUp($('#finale-me'), 0, me, '_finale-me', { cancellable: false });
    countUp($('#finale-opp'), 0, opp, '_finale-opp', { cancellable: false });
  }, 880);
}

/* ─────────── المايك ─────────── */

let mic = null;
let lastSettled = '';

/**
 * كل قطعةٍ نهائية من المتعرّف = وقفةٌ في الكلام = شارةٌ واحدة.
 * فمن قال «أبو بكر… عمر… عثمان» خرجت له ثلاث شارات لا تسع كلمات.
 */
function startMic() {
  if (mic) return;
  lastSettled = '';
  mic = startListening({
    onUpdate: (live, settled) => {
      $('#mz-live').textContent = live.slice(-80);
      if (settled.length <= lastSettled.length) return;
      const fresh = settled.slice(lastSettled.length).trim();
      lastSettled = settled;
      if (fresh) send('mazad-answer', { text: fresh });
    },
    onError: (e) => { stopMic(); window.alert(e); },
  });
  if (!mic) return;
  $('#mz-mic').classList.add('on');
  $('#mz-mic').textContent = '⏹ أوقف المايك';
  $('#mz-live').hidden = false;
}

function stopMic() {
  if (!mic) return;
  mic.stop();
  mic = null;
  lastSettled = '';
  const btn = $('#mz-mic');
  if (btn) { btn.classList.remove('on'); btn.textContent = '🎙 المايك'; }
  const live = $('#mz-live');
  if (live) { live.hidden = true; live.textContent = ''; }
}

/* ─────────── الربط ─────────── */

/** إرسالٌ مؤجَّل: الكتابة الحيّة لا تُغرق الخادم بحرفٍ حرف. */
function debounced(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const pushText = debounced((v) => send('mazad-config', { patch: { text: v } }), 280);
const pushSeconds = debounced((v) => send('mazad-config', { patch: { seconds: v } }), 280);
const pushPoints = debounced((v) => send('mazad-config', { patch: { points: v } }), 280);

function submitTyped() {
  const input = $('#mz-typed');
  const t = input.value.trim();
  if (!t) return;
  send('mazad-answer', { text: t });
  input.value = '';
}

export function bindMazadUI() {
  // ربطٌ آمن: عنصرٌ مفقود لا يُسقط الشاشة كلها قبل أن تتصل
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);

  on('#mz-start', 'click', () => send('mazad-start'));
  on('#mz-copy-link', 'click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#mz-invite-link').value);
      e.target.textContent = 'نُسخ ✓';
    } catch {
      $('#mz-invite-link').select();
      e.target.textContent = 'انسخه يدوياً';
    }
    setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1800);
  });
  on('#mz-end', 'click', () => { if (window.confirm('أنهِ الجلسة واحسب الفائز؟')) send('mazad-end'); });

  // الإعداد
  on('#mz-text', 'input', (e) => pushText(e.target.value));
  on('#mz-seconds', 'input', (e) => pushSeconds(e.target.value));
  on('#mz-points', 'input', (e) => pushPoints(e.target.value));
  on('#mz-open', 'click', () => send('mazad-open', { amount: $('#mz-open-amount').value }));
  on('#mz-open-amount', 'keydown', (e) => { if (e.key === 'Enter') $('#mz-open').click(); });

  // المزايدة
  on('#mz-raise', 'click', () => send('mazad-raise', { amount: $('#mz-raise-amount').value }));
  on('#mz-raise-amount', 'keydown', (e) => { if (e.key === 'Enter') $('#mz-raise').click(); });
  on('#mz-hand', 'click', () => send('mazad-hand'));

  // المؤقّت
  on('#mz-play', 'click', () => send('mazad-timer', { action: view?.round?.timer.running ? 'pause' : 'start' }));
  on('#mz-reset', 'click', () => send('mazad-timer', { action: 'reset' }));
  on('#mz-minus', 'click', () => send('mazad-timer', { action: 'adjust', delta: -10 }));
  on('#mz-plus', 'click', () => send('mazad-timer', { action: 'adjust', delta: 10 }));

  // الإجابات
  on('#mz-mic', 'click', () => (mic ? stopMic() : startMic()));
  on('#mz-send-typed', 'click', submitTyped);
  on('#mz-typed', 'keydown', (e) => { if (e.key === 'Enter') submitTyped(); });
  on('#mz-clear', 'click', () => send('mazad-clear'));
  on('#mz-answers', 'click', (e) => {
    const btn = e.target.closest('.mz-chip-x');
    // النصّ مع الموضع: ختمٌ يمنع حذف شارةٍ أزاحها حذفُ الخصم في اللحظة نفسها
    if (btn) send('mazad-remove', { index: Number(btn.dataset.i), text: btn.dataset.text });
  });

  // الحكم والانتقال
  on('#mz-done', 'click', () => send('mazad-judge', { done: true }));
  on('#mz-failed', 'click', () => send('mazad-judge', { done: false }));
  on('#mz-next-round', 'click', () => send('mazad-next'));

  if (!speechSupported()) {
    const btn = $('#mz-mic');
    if (btn) { btn.disabled = true; btn.title = 'المايك يحتاج Chrome أو Edge على https'; }
    const note = $('#mz-mic-note');
    if (note) note.textContent = 'المايك لا يعمل في هذا المتصفح — اكتب الإجابات';
  }

  // طبقة الختام مشتركة بين الألعاب: تُربط مرة واحدة مهما دخلت أيّها
  const finale = $('#finale');
  if (finale && !finale.dataset.closeBound) {
    finale.dataset.closeBound = '1';
    on('#finale-close', 'click', () => {
      finale.classList.remove('is-open');
      setTimeout(() => { finale.hidden = true; }, 420);
    });
  }
}
