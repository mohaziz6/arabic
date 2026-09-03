/**
 * شاشة «سَنَد» — عرض وإدخال فقط؛ كل المنطق في الخادم.
 * لا مايكروفون: اللاعبان يتناقشان بمكالمة بينهما، والتطبيق لوح نقاط وحافظ سرّ.
 */

const $ = (s) => document.querySelector(s);

/** نصوص الروايات بيانات لا HTML. */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** يُظهر طبقة بانتقالها — بإعادة تدفّق لا بـ rAF (لا يعمل في تبويب خلفي). */
function reveal(el) {
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('shown');
}

function hide(el) {
  el.hidden = true;
  el.classList.remove('shown');
}

const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arNum = (n) => String(n).split('').map((d) => AR[+d] ?? d).join('');

/* ─────────── الصوت ─────────── */

let audio = null;
function tone({ freq, dur, type = 'sine', gain = 0.09, slideTo }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!audio) audio = new AC();
  if (audio.state === 'suspended') audio.resume();
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audio.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + dur);
  vol.gain.setValueAtTime(gain, audio.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
  osc.connect(vol).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + dur);
}

const sfx = {
  deal: () => tone({ freq: 380, slideTo: 170, dur: 0.12, type: 'triangle' }),
  pick: () => { tone({ freq: 520, slideTo: 780, dur: 0.16, type: 'triangle', gain: 0.1 });
                setTimeout(() => tone({ freq: 780, slideTo: 1040, dur: 0.2, gain: 0.07 }), 90); },
  tick: () => tone({ freq: 1100, slideTo: 800, dur: 0.04, type: 'square', gain: 0.05 }),
  right: () => { tone({ freq: 660, slideTo: 990, dur: 0.22, gain: 0.12 });
                 setTimeout(() => tone({ freq: 990, slideTo: 1320, dur: 0.32, gain: 0.09 }), 130); },
  wrong: () => { tone({ freq: 240, slideTo: 110, dur: 0.34, type: 'sawtooth', gain: 0.1 });
                 setTimeout(() => tone({ freq: 150, slideTo: 80, dur: 0.4, gain: 0.08 }), 150); },
};

/* ─────────── الاتصال ─────────── */

let ws = null;
let view = null;
let timer = null;
let left = 0;

export function connect({ mode, name, code, onJoined, onError }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(mode === 'create'
      ? { type: 'create', game: 'sanad', name }
      : { type: 'join', game: 'sanad', code, name }));
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'joined') onJoined?.(m);
    else if (m.type === 'state') render(m.state);
    else if (m.type === 'sanad-verdict') sfx[m.iWon ? 'right' : 'wrong']();
    else if (m.type === 'error') {
      $('#sn-options')?.classList.remove('locked');   // وإلا قُفلت الخيارات أبداً
      onError?.(m.error);
    }
  });

  ws.addEventListener('error', () => onError?.('تعذّر الاتصال بالخادم.'));
}

const send = (type, extra = {}) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, ...extra }));

/* ─────────── العرض ─────────── */

function render(s) {
  const prev = view;
  view = s;

  $('#sanad-code').textContent = s.code;
  $('#sn-me').textContent = s.me?.name ?? '—';
  $('#sn-me-score').textContent = String(s.scores?.[s.me?.id] ?? 0);
  $('#sn-opp').textContent = s.opponent?.name ?? 'بانتظار الخصم…';
  $('#sn-opp-score').textContent = s.opponent ? String(s.scores[s.opponent.id] ?? 0) : '0';
  $('#sn-me-role').textContent = s.me?.isNarrator ? 'الراوي' : (s.opponent ? 'الحاكم' : '');
  $('#sn-opp-role').textContent = s.opponent ? (s.opponent.isNarrator ? 'الراوي' : 'الحاكم') : '';

  bumpScores(prev, s);

  const inviteBox = $('#sn-invite');
  inviteBox.hidden = Boolean(s.opponent);
  if (!s.opponent) $('#sn-invite-link').value = `${location.origin}/?code=${s.code}&game=sanad`;

  $('#sn-start').hidden = !(s.status === 'lobby' && s.opponent);

  if (s.status === 'over') return renderOver(s);
  $('#sn-over').hidden = true;

  if (s.status !== 'round') {
    for (const id of ['#sn-stage', '#sn-options', '#sn-waiting', '#sn-told', '#sn-ruling', '#sn-reveal']) hide($(id));
    $('#sn-step').textContent = s.opponent ? 'جاهزون' : 'بانتظار الخصم';
    return;
  }

  $('#sn-step').textContent =
    `الشخصية ${arNum(s.progress.figure)} من ${arNum(s.progress.figures)} — السؤال ${arNum(s.progress.question)}`;

  renderStage(s, prev);
  renderPhase(s, prev);
}

/** النقاط تقفز حين تزيد — الربح يجب أن يُرى. */
function bumpScores(prev, s) {
  if (!prev?.scores) return;
  for (const [el, id] of [['#sn-me-score', s.me?.id], ['#sn-opp-score', s.opponent?.id]]) {
    if (id && s.scores[id] > (prev.scores[id] ?? 0)) {
      const node = $(el);
      node.classList.remove('bump');
      void node.offsetWidth;
      node.classList.add('bump');
    }
  }
}

function renderStage(s, prev) {
  const stage = $('#sn-stage');
  if (!s.figure) { hide(stage); return; }

  const changed = prev?.figure?.id !== s.figure.id;
  $('#sn-figure-name').textContent = s.figure.name;
  $('#sn-figure-era').textContent = s.figure.era;
  $('#sn-q-num').textContent = arNum(s.progress.question);
  $('#sn-question').textContent = s.question.prompt;
  $('#sn-question-brief').textContent = s.question.brief;

  reveal(stage);
  if (changed) {                       // شخصية جديدة تدخل بحركة
    stage.classList.remove('enter');
    void stage.offsetWidth;
    stage.classList.add('enter');
  }
}

function renderPhase(s, prev) {
  const isNarrator = Boolean(s.me?.isNarrator);
  const phaseChanged = prev?.phase !== s.phase || prev?.progress?.question !== s.progress.question;

  // مرحلة الاختيار
  if (s.phase === 'pick') {
    hide($('#sn-told')); hide($('#sn-ruling')); hide($('#sn-reveal'));
    stopTimer();
    if (isNarrator) {
      hide($('#sn-waiting'));
      if (phaseChanged) dealOptions(s.options);
      reveal($('#sn-options'));
    } else {
      hide($('#sn-options'));
      $('#sn-wait-text').textContent = 'الراوي يختار روايته…';
      reveal($('#sn-waiting'));
    }
    return;
  }

  // مرحلة النقاش
  if (s.phase === 'talk') {
    hide($('#sn-options')); hide($('#sn-waiting')); hide($('#sn-reveal'));
    $('#sn-told-tag').textContent = isNarrator ? 'روايتك — أقنعه بها' : 'ما رواه خصمك';
    $('#sn-told-text').textContent = s.told?.text ?? '';
    reveal($('#sn-told'));

    if (isNarrator) hide($('#sn-ruling'));
    else reveal($('#sn-ruling'));

    if (phaseChanged) startTimer(s.talkSeconds);
    return;
  }

  // الكشف
  if (s.phase === 'reveal') {
    stopTimer();
    hide($('#sn-options')); hide($('#sn-waiting')); hide($('#sn-ruling'));
    $('#sn-told-tag').textContent = 'ما رُوي';
    $('#sn-told-text').textContent = s.told?.text ?? '';
    reveal($('#sn-told'));
    renderReveal(s);
  }
}

const KIND_LABEL = { true: 'كانت صحيحة', crafted: 'كذبة محكمة', absurd: 'كذبة فاضحة' };

function renderReveal(s) {
  const box = $('#sn-reveal');
  const r = s.lastRound;
  const iWon = r?.winnerId === s.me?.id;

  $('#sn-kind').textContent = KIND_LABEL[s.told?.kind] ?? '';
  $('#sn-kind').className = `reveal-kind ${s.told?.kind ?? ''}`;
  $('#sn-gain').textContent = `${iWon ? 'لك' : 'له'} ${arNum(s.told?.points ?? 0)}`;
  $('#sn-gain').classList.toggle('mine', iWon);
  $('#sn-truth').textContent = s.truth ?? '';
  reveal(box);   // زر التالي مفتوح للطرفين
}

function renderOver(s) {
  for (const id of ['#sn-stage', '#sn-options', '#sn-waiting', '#sn-told', '#sn-ruling', '#sn-reveal']) hide($(id));
  stopTimer();
  const me = s.scores[s.me.id];
  const opp = s.scores[s.opponent?.id] ?? 0;
  $('#sn-over-title').textContent = s.winnerId === null
    ? 'تعادلتما'
    : (s.winnerId === s.me.id ? 'أنت ثقةٌ في هذا الديوان' : 'غلبك خصمك هذه المرة');
  $('#sn-over-score').textContent = `${s.me.name}: ${me} — ${s.opponent?.name ?? ''}: ${opp}`;
  reveal($('#sn-over'));
}

/* ─────────── خيارات الراوي ─────────── */

const KIND_NAME = { true: 'الرواية الصحيحة', crafted: 'كذبة محكمة', absurd: 'كذبة فاضحة' };
const KIND_HINT = {
  true: 'آمنة — وقد يكذّبك فتكسب',
  crafted: 'يصعب كشفها إن أحسنتَ',
  absurd: 'مكشوفة — تحتاج وجهاً عريضاً',
};

function dealOptions(options) {
  const wrap = $('#sn-options');
  wrap.innerHTML = (options ?? [])
    .map(
      (o, i) => `
      <button class="story-card ${o.kind}" type="button" data-kind="${o.kind}" style="--i:${i}">
        <span class="story-points">${arNum(o.points)}</span>
        <span class="story-kind">${KIND_NAME[o.kind]}</span>
        <p class="story-text">${esc(o.text)}</p>
        <span class="story-hint">${KIND_HINT[o.kind]}</span>
      </button>`,
    )
    .join('');

  const cards = [...wrap.querySelectorAll('.story-card')];
  cards.forEach((c, i) => {
    setTimeout(() => { c.classList.add('dealt'); sfx.deal(); }, 90 * i);
    c.addEventListener('click', () => {
      if (wrap.classList.contains('locked')) return;
      wrap.classList.add('locked');
      c.classList.add('chosen');
      cards.filter((x) => x !== c).forEach((x) => x.classList.add('dropped'));
      sfx.pick();
      setTimeout(() => send('sanad-choose', { kind: c.dataset.kind }), 420);
    });
  });
  wrap.classList.remove('locked');
}

/* ─────────── المؤقّت ─────────── */

function startTimer(seconds) {
  stopTimer();
  left = seconds;
  const ring = $('#sn-timer-ring');
  ring.hidden = false;
  $('#sn-timer').textContent = arNum(left);
  timer = setInterval(() => {
    left -= 1;
    $('#sn-timer').textContent = arNum(Math.max(0, left));
    ring.classList.toggle('urgent', left <= 10);
    if (left <= 5 && left > 0) sfx.tick();
    if (left <= 0) stopTimer();          // ينتهي الوقت والحكم يبقى للخصم
  }, 1000);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
  $('#sn-timer-ring').hidden = true;
  $('#sn-timer-ring').classList.remove('urgent');
}

/* ─────────── الربط ─────────── */

export function bindSanadUI() {
  $('#sn-start').addEventListener('click', () => send('sanad-start'));
  $('#sn-trust').addEventListener('click', () => send('sanad-rule', { ruling: 'trust' }));
  $('#sn-liar').addEventListener('click', () => send('sanad-rule', { ruling: 'liar' }));
  $('#sn-next').addEventListener('click', () => send('sanad-next'));
  $('#sn-copy-link').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#sn-invite-link').value);
      e.target.textContent = 'نُسخ ✓';
    } catch {
      $('#sn-invite-link').select();
      e.target.textContent = 'انسخه يدوياً';
    }
    setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1800);
  });
}
