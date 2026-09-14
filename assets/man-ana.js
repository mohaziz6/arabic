/**
 * شاشة «مَن أنا» — عرض وإدخال فقط؛ كل المنطق والجواب في الخادم.
 *
 * إيقاع اللعبة من الخادم: تلميحٌ كل خمس عشرة ثانية، والمتصفح يعدّ محلياً بين
 * البثّين من `clueMsLeft` ثم يُضبط عند كل تلميح — فلا ينحرف عدّاده عن خصمه.
 */

import { emblemSvg } from './man-ana-art.js';

const $ = (s) => document.querySelector(s);

/** نصوص التلميحات وتخمينات اللاعبين بيانات لا HTML. */
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
  clue: () => { tone({ freq: 300, slideTo: 480, dur: 0.22, type: 'triangle', gain: 0.08 });
                tone({ freq: 620, dur: 0.26, gain: 0.05, delay: 0.1 }); },
  tick: () => tone({ freq: 1000, slideTo: 760, dur: 0.04, type: 'square', gain: 0.045 }),
  right: () => { tone({ freq: 660, slideTo: 990, dur: 0.2, gain: 0.12 });
                 tone({ freq: 990, slideTo: 1320, dur: 0.32, gain: 0.09, delay: 0.12 }); },
  wrong: () => { tone({ freq: 240, slideTo: 110, dur: 0.3, type: 'sawtooth', gain: 0.1 });
                 tone({ freq: 150, slideTo: 80, dur: 0.34, gain: 0.07, delay: 0.14 }); },
  stolen: () => tone({ freq: 300, slideTo: 200, dur: 0.26, type: 'triangle', gain: 0.07 }),
  gone: () => tone({ freq: 200, slideTo: 120, dur: 0.5, type: 'triangle', gain: 0.07 }),
};

/* ─────────── الاتصال ─────────── */

let ws = null;
let view = null;

/** يطلب الجولة التالية من المباراة — أيُّ الطرفين. */
export function sendMatchNext() {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'match-next' }));
}

/** يُغلق المقبس ويُنسيه — تُستدعى عند تبديل جولة المباراة وعند الخروج. */
export function leave() {
  finaleShown = false;
  if (!ws) return;
  const sock = ws;
  ws = null;                         // قبل الإغلاق: لئلا يُعاد الدخول على مقبسٍ يُغلق
  try { sock.close(); } catch { /* مغلقٌ سلفاً */ }
}

export function connect({ mode, name, code, playerId, games, onJoined, onError, onSwitch }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(mode === 'create'
      ? { type: 'create', game: 'man-ana', games, name }
      : { type: 'join', game: 'man-ana', code, name, playerId }));
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'match-switch') { leave(); onSwitch?.(m.game, m.roundNo); }
    else if (m.type === 'joined') onJoined?.(m);
    else if (m.type === 'state') { render(m.state); window.Diwan?.onState?.(m.state); }
    else if (m.type === 'man-ana-clue') onClue(m);
    else if (m.type === 'man-ana-result') onResult(m);
    else if (m.type === 'error') {
      sending = false;
      // رفضٌ لينٌ = نتيجة سباق طبيعية؛ الحالة الجديدة تصل بعده وتشرح نفسها
      if (!m.soft) onError?.(m.error);
    }
  });

  ws.addEventListener('error', () => onError?.('تعذّر الاتصال بالخادم.'));
}

const send = (type, extra = {}) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, ...extra }));

/** تخمينٌ أُرسل وينتظر ردّاً — يمنع إرسالين قبل أن يصل الأول. */
let sending = false;

function onClue({ exhausted }) {
  if (exhausted) { sfx.gone(); return; }
  sfx.clue();
  dipEmblem();                 // الشعار يهبط ويرتفع عند كل تلميح
}

function onResult({ mine, correct, solved }) {
  if (mine) sfx[correct ? 'right' : 'wrong']();
  else if (solved) sfx.stolen();      // سبقك خصمك — نغمة انسحاب لا نغمة خطأ
}

/* ─────────── الشعار ─────────── */

/** هبطةٌ قصيرة ثم ارتفاع — تُعلن وصول تلميح جديد بلا كلمات. */
function dipEmblem() {
  const el = $('#ma-emblem');
  if (!el || reducedMotion()) return;
  el.classList.remove('dip');
  void el.offsetWidth;                // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
  el.classList.add('dip');
  // يُنزَع بعد انتهائها، وإلا غلب `dip` على `emblem-breathe` فتوقّف التنفّس للأبد
  el.addEventListener('animationend', () => el.classList.remove('dip'), { once: true });
}

/* ─────────── العرض ─────────── */

function render(s) {
  const prev = view;
  view = s;

  $('#man-ana-code').textContent = s.code;
  $('#ma-me').textContent = s.me?.name ?? '—';
  $('#ma-opp').textContent = s.opponent?.name ?? 'بانتظار الخصم…';

  // الطيران يجري في renderReveal بعد ظهور البطاقة — من هنا رسمٌ فوري فقط
  if (!(s.phase === 'reveal' && prev?.phase !== 'reveal')) paintScores(s);

  const invite = $('#ma-invite');
  invite.hidden = Boolean(s.opponent);
  if (!s.opponent) $('#ma-invite-link').value = `${location.origin}/?code=${s.code}&game=man-ana`;

  $('#ma-start').hidden = !(s.status === 'lobby' && s.opponent);

  if (s.status === 'over') return renderOver(s);
  $('#ma-over').hidden = true;

  if (s.status !== 'round') {
    for (const id of ['#ma-clues', '#ma-misses', '#ma-answer', '#ma-reveal']) hide($(id));
    $('#ma-step').textContent = s.opponent ? 'جاهزون' : 'بانتظار الخصم';
    $('#ma-points').textContent = '—';
    stopTimer();
    reveal($('#ma-stage'));
    return;
  }

  $('#ma-step').textContent =
    `الشخصية ${arNum(s.progress.figure)} من ${arNum(s.progress.figures)}`;
  renderLadder(s);
  reveal($('#ma-stage'));

  const fresh = prev?.progress?.figure !== s.progress.figure;
  if (fresh) { $('#ma-guess').value = ''; dipEmblem(); }

  renderClues(s, prev);
  renderMisses(s);
  renderAnswerBar(s);
  renderReveal(s, prev);

  if (s.phase === 'clues') startTimer(s.clueMsLeft ?? s.clueSeconds * 1000);
  else stopTimer();
}

/** سلّم القيمة: ستّ درجات تنطفئ واحدةً بعد أخرى مع كل تلميح. */
function renderLadder(s) {
  const wrap = $('#ma-ladder');
  const sig = `${s.pointsLadder.length}:${s.progress.clue}`;
  if (wrap.dataset.sig !== sig) {
    wrap.dataset.sig = sig;
    wrap.innerHTML = s.pointsLadder
      .map((p, i) => `<i class="${i < s.progress.clue - 1 ? 'spent' : i === s.progress.clue - 1 ? 'now' : ''}">${arNum(p)}</i>`)
      .join('');
  }
  const badge = $('#ma-points');
  if (badge.textContent !== String(arNum(s.points))) {
    badge.textContent = arNum(s.points);
    badge.classList.remove('drop');
    void badge.offsetWidth;
    badge.classList.add('drop');
  }
  $('#ma-points-label').textContent = `قيمتها الآن ${points(s.points)}`;
}

/** كل تلميح ورقةُ مخطوطٍ تنزلق داخلةً، والأحدث في الأعلى مضاءً. */
function renderClues(s, prev) {
  const box = $('#ma-clues');
  const seen = prev?.clues?.length ?? 0;
  const sameFigure = prev?.progress?.figure === s.progress.figure;

  if (!sameFigure || s.clues.length < seen) box.innerHTML = '';

  const from = (!sameFigure) ? 0 : Math.max(seen, box.children.length);
  for (let i = from; i < s.clues.length; i++) {
    const strip = document.createElement('div');
    strip.className = 'clue-strip';
    strip.innerHTML = `<span class="clue-num">${arNum(i + 1)}</span>
      <p>${esc(s.clues[i])}</p>`;
    box.prepend(strip);                    // الأحدث فوق، والأقدم ينزل ويخفت
    void strip.offsetWidth;
    strip.classList.add('landed');
  }
  // الأحدث في مسرحه وحده، والأقدم ينزل تحته مطويّاً أصغر
  [...box.children].forEach((c, i) => {
    c.classList.toggle('lead', i === 0);
    c.classList.toggle('old', i > 0);
  });

  if (s.era) { $('#ma-era').textContent = s.era; reveal($('#ma-era')); }
  else hide($('#ma-era'));

  reveal(box);
}

/** التخمينات الخاطئة بنصّها — معلومةٌ مكسوبة للطرفين، ومتعةٌ في ذاتها. */
function renderMisses(s) {
  const box = $('#ma-misses');
  if (!s.misses.length) { hide(box); box.dataset.n = '0'; return; }

  if (box.dataset.n !== String(s.misses.length)) {
    box.dataset.n = String(s.misses.length);
    box.innerHTML = s.misses
      .map((m) => `<span class="miss ${m.mine ? 'mine' : ''}">
          <b>${esc(m.mine ? 'أنت' : s.opponent?.name ?? 'خصمك')}</b> ${esc(m.text)} <i>✕</i>
        </span>`)
      .join('');
  }
  reveal(box);
}

function renderAnswerBar(s) {
  const bar = $('#ma-answer');
  if (s.phase !== 'clues') { hide(bar); return; }

  const locked = Boolean(s.iLocked);
  bar.classList.toggle('locked', locked);
  $('#ma-guess').disabled = locked;
  $('#ma-send').disabled = locked;
  $('#ma-answer-note').textContent = locked
    ? 'أخطأتَ — انتظر التلميح التالي'
    : s.oppLocked ? 'أخطأ خصمك — الميدان لك حتى التلميح التالي' : 'اكتب الاسم بلا تشكيل';
  reveal(bar);
}

/* ─────────── مؤقّت التلميح ─────────── */

let timer = null;
let endsAt = 0;

function startTimer(msLeft) {
  stopTimer();
  endsAt = Date.now() + Math.max(0, msLeft);
  const ring = $('#ma-timer-ring');
  ring.hidden = false;
  $('#ma-clock-label').hidden = false;
  paintTimer();
  // بالوقت لا بـ rAF: الأخير لا يعمل في تبويب خلفي فيتجمّد عدّاد من لا ينظر
  timer = setInterval(paintTimer, 250);
}

function paintTimer() {
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const prev = Number($('#ma-timer').dataset.left || '-1');
  $('#ma-timer').textContent = arNum(left);
  $('#ma-timer').dataset.left = String(left);
  $('#ma-timer-ring').classList.toggle('urgent', left <= 3);
  if (left <= 3 && left > 0 && left !== prev) sfx.tick();
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
  const ring = $('#ma-timer-ring');
  ring.hidden = true;
  $('#ma-clock-label').hidden = true;
  ring.classList.remove('urgent');
}

/* ─────────── الكشف ─────────── */

function renderReveal(s, prev) {
  const box = $('#ma-reveal');
  if (s.phase !== 'reveal') { hide(box); return; }

  const iWon = s.solvedBy === s.me?.id;
  const nobody = !s.solvedBy;

  $('#ma-reveal-mark').textContent = nobody ? '؟' : iWon ? '✓' : '✕';
  $('#ma-reveal-mark').className = `ma-reveal-mark ${nobody ? 'none' : iWon ? 'win' : 'lose'}`;
  $('#ma-reveal-who').textContent = nobody
    ? 'انقضت التلميحات ولم يُصِبها أحد'
    : iWon ? 'أصبتَ' : 'سبقك خصمك';
  $('#ma-reveal-name').textContent = s.answer?.name ?? '';
  $('#ma-reveal-era').textContent = s.answer?.era ?? '';
  $('#ma-reveal-body').textContent = s.answer?.reveal ?? '';
  $('#ma-gain').textContent = nobody ? 'بلا نقاط' : `${iWon ? 'لك' : 'له'} ${points(s.earned)}`;
  $('#ma-gain').classList.toggle('mine', iWon);

  reveal(box);

  // لحظة الكشف هي ثمرة الجولة، ولوح التلميحات يدفعها تحت الطيّة
  if (prev?.phase !== 'reveal') {
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }

  // بعد ظهور البطاقة: النقاط تطير منها إلى لوح الفائز ثم يعدّ الرقم
  if (prev?.phase !== 'reveal' && !nobody) {
    if (reducedMotion()) paintScores(s);
    else laterCancellable(() => paintScores(s, { animate: true }), 380);
  } else if (prev?.phase !== 'reveal') {
    paintScores(s);
  }
}

/* ─────────── لوح النقاط ─────────── */

const shownScores = {};
let scoreTimers = [];
const laterCancellable = (fn, ms) => { scoreTimers.push(setTimeout(fn, ms)); };

function cancelScoreAnim() {
  scoreTimers.forEach(clearTimeout);
  scoreTimers = [];
  document.querySelectorAll('.point-token').forEach((t) => t.remove());
}

function paintScores(s, { animate = false } = {}) {
  cancelScoreAnim();                       // بثٌّ جديد يُلغي مشهداً جارياً
  for (const [sel, id] of [['#ma-me-score', s.me?.id], ['#ma-opp-score', s.opponent?.id]]) {
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
    flyThenCount(node, from, target, id);
  }
}

function flyThenCount(node, from, to, id) {
  const a = $('#ma-gain').getBoundingClientRect();
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
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(from + (to - from) * eased);
    node.textContent = String(value);
    shownScores[id] = value;
    if (t < 1) later(step, 40);
    else { shownScores[id] = to; node.textContent = String(to); }
  };
  step();
}

/* ─────────── الختام ─────────── */

// تُصفَّر مع كل جلسةٍ جديدة على الصفحة نفسها (جولةُ مباراةٍ تالية، أو إعادة
// دخول): راية لا تُصفَّر تعني أن الجلسة الثانية لا ختام لها — ولا ذيلَ مباراةٍ
// ولا زرَّ جولةٍ تالية معه.
let finaleShown = false;

const FINALE = {
  win: { mark: '✦', title: 'عرفتَهم قبل أن يُفصحوا', line: 'قرأتَ الرجلَ من أول سطرٍ عنه.' },
  lose: { mark: '✕', title: 'سبقك خصمك إليهم', line: 'كان أسرعَ منك إلى وجوه الناس.' },
  tie: { mark: '=', title: 'تعادلتما', line: 'عرفتما القومَ سواءً بسواء.' },
};

function renderOver(s) {
  for (const id of ['#ma-clues', '#ma-misses', '#ma-answer', '#ma-reveal', '#ma-era']) hide($(id));
  stopTimer();
  const me = s.scores[s.me.id] ?? 0;
  const opp = s.scores[s.opponent?.id] ?? 0;
  const outcome = s.winnerId === null ? 'tie' : (s.winnerId === s.me.id ? 'win' : 'lose');

  $('#ma-over-title').textContent = FINALE[outcome].title;
  $('#ma-over-score').textContent = `${s.me.name}: ${me} — ${s.opponent?.name ?? ''}: ${opp}`;
  reveal($('#ma-over'));

  if (!finaleShown) { finaleShown = true; playFinale(s, outcome, me, opp); }
}

/** مشهد الختام — الطبقة نفسها التي لسَنَد ومَعاني، فالنهاية واحدة في الديوان. */
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
    if (outcome === 'lose') sfx.wrong(); else sfx.right();
  }, 320);

  // غير قابلة للإلغاء: بثٌّ يصل أثناءها كان يجمّد الحصيلة على رقم ناقص
  setTimeout(() => {
    countUp($('#finale-me'), 0, me, '_finale-me', { cancellable: false });
    countUp($('#finale-opp'), 0, opp, '_finale-opp', { cancellable: false });
  }, 880);
}

/* ─────────── الربط ─────────── */

/** حرفان عربيان على الأقل — وإلا رفضه الخادم رفضاً ليّناً فاختفى بلا خبر. */
const ARABIC_ENOUGH = /[\u0600-\u06FF].*[\u0600-\u06FF]/s;

function submitGuess() {
  const input = $('#ma-guess');
  const text = input.value.trim();
  if (!text || sending || view?.phase !== 'clues' || view?.iLocked) return;

  if (!ARABIC_ENOUGH.test(text)) {
    const note = $('#ma-answer-note');
    note.textContent = 'اكتب الاسم بالعربية';
    $('#ma-answer').classList.add('locked');       // اهتزازةٌ وحدٌّ طيني، بلا قفلٍ فعلي
    setTimeout(() => { if (view?.phase === 'clues') renderAnswerBar(view); }, 1400);
    return;                                        // لا يُمسح المكتوب: يصحّحه صاحبه
  }

  sending = true;
  send('man-ana-guess', { text });
  input.value = '';
  setTimeout(() => { sending = false; }, 400);
}

export function bindManAnaUI() {
  // ربطٌ آمن: عنصرٌ مفقود لا يُسقط الشاشة كلها قبل أن تتصل
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);

  const slot = $('#ma-emblem-art');
  if (slot && !slot.childElementCount) slot.innerHTML = emblemSvg();

  on('#ma-start', 'click', () => send('man-ana-start'));
  on('#ma-next', 'click', () => send('man-ana-next'));
  on('#ma-send', 'click', submitGuess);
  on('#ma-guess', 'keydown', (e) => { if (e.key === 'Enter') submitGuess(); });
  on('#ma-copy-link', 'click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#ma-invite-link').value);
      e.target.textContent = 'نُسخ ✓';
    } catch {
      $('#ma-invite-link').select();
      e.target.textContent = 'انسخه يدوياً';
    }
    setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1800);
  });

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
