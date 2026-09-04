/**
 * شاشة «مَعاني» — عرض وإدخال فقط؛ كل المنطق والجواب في الخادم.
 *
 * سباقٌ متزامن بلا مؤقّت: السؤال يظهر للخصمين معاً، وأول من يصيب يأخذه.
 * فالحركة هنا ليست زينة — هي التي تقول للاعب: أُغلق السؤال، أخطأتَ، خلا لك الميدان.
 */

const $ = (s) => document.querySelector(s);

/** الكلمات بيانات لا HTML. */
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

/** تمييزٌ عربي: «نقطة» و«نقطتان» و«ثلاث نقاط» — لا «١ نقاط». */
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
  deal: () => tone({ freq: 420, slideTo: 190, dur: 0.09, type: 'triangle', gain: 0.06 }),
  level: () => {
    [440, 587, 784].forEach((f, i) => tone({ freq: f, dur: 0.3, gain: 0.08, delay: i * 0.11 }));
  },
  right: () => { tone({ freq: 660, slideTo: 990, dur: 0.2, gain: 0.12 });
                 tone({ freq: 990, slideTo: 1320, dur: 0.3, gain: 0.09, delay: 0.12 }); },
  wrong: () => { tone({ freq: 240, slideTo: 110, dur: 0.3, type: 'sawtooth', gain: 0.1 });
                 tone({ freq: 150, slideTo: 80, dur: 0.34, gain: 0.07, delay: 0.14 }); },
  stolen: () => tone({ freq: 300, slideTo: 200, dur: 0.26, type: 'triangle', gain: 0.07 }),
};

/* ─────────── الاتصال ─────────── */

let ws = null;
let view = null;

export function connect({ mode, name, code, onJoined, onError }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(mode === 'create'
      ? { type: 'create', game: 'maani', name }
      : { type: 'join', game: 'maani', code, name }));
  });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'joined') onJoined?.(m);
    else if (m.type === 'state') render(m.state);
    else if (m.type === 'maani-result') onResult(m);
    else if (m.type === 'error') {
      unlockBoard();                 // وإلا بقي اللوح مقفلاً على رفضٍ من الخادم
      // رفضٌ لينٌ = نتيجة سباق طبيعية (سبقك خصمك، أجبتَ سلفاً). الحالة الجديدة
      // تصل بعده بلحظة وتشرح نفسها، فالتنبيه عليه يقطع اللعب اثنتي عشرة مرة.
      if (!m.soft) onError?.(m.error);
    }
  });

  ws.addEventListener('error', () => onError?.('تعذّر الاتصال بالخادم.'));
}

const send = (type, extra = {}) => ws?.readyState === 1 && ws.send(JSON.stringify({ type, ...extra }));

/** إجابتي أُرسلت وأنتظر جوابها — يمنع ضغطتين على زرين قبل ردّ الخادم. */
let awaitingAnswer = false;

function unlockBoard() {
  awaitingAnswer = false;
  document.querySelectorAll('#screen-maani .picked').forEach((el) => el.classList.remove('picked'));
}

function onResult({ mine, correct }) {
  if (mine) sfx[correct ? 'right' : 'wrong']();
  else if (correct) sfx.stolen();        // سبقك خصمك — نغمة انسحاب لا نغمة خطأ
}

/* ─────────── العرض ─────────── */

function render(s) {
  const prev = view;
  view = s;

  $('#maani-code').textContent = s.code;
  $('#mn-me').textContent = s.me?.name ?? '—';
  $('#mn-opp').textContent = s.opponent?.name ?? 'بانتظار الخصم…';

  // الطيران يجري في renderVerdict بعد ظهور البطاقة — من هنا رسمٌ فوري فقط
  if (!(s.phase === 'reveal' && prev?.phase !== 'reveal')) paintScores(s);

  const invite = $('#mn-invite');
  invite.hidden = Boolean(s.opponent);
  if (!s.opponent) $('#mn-invite-link').value = `${location.origin}/?code=${s.code}&game=maani`;

  $('#mn-start').hidden = !(s.status === 'lobby' && s.opponent);

  if (s.status === 'over') return renderOver(s);
  $('#mn-over').hidden = true;

  if (s.status !== 'round') {
    for (const id of ['#mn-level', '#mn-pair', '#mn-relations', '#mn-hunt',
                      '#mn-intruder', '#mn-verdict', '#mn-wait']) hide($(id));
    $('#mn-step').textContent = s.opponent ? 'جاهزون' : 'بانتظار الخصم';
    renderTrack(s);
    return;
  }

  $('#mn-step').textContent =
    `المستوى ${arNum(s.progress.level)} — سؤال ${arNum(s.progress.inLevel)} من ${arNum(s.progress.perLevel)}`;
  renderTrack(s);

  $('#mn-level-num').textContent = arNum(s.progress.level);
  $('#mn-level-name').textContent = s.level.name;
  $('#mn-level-brief').textContent = s.level.brief;
  $('#mn-level-points').textContent = `${points(s.level.points)} للإصابة`;
  reveal($('#mn-level'));

  maybeAnnounceLevel(s);
  renderBoard(s, prev);
  renderStatuses(s);
  renderVerdict(s, prev);
}

/** مسار الجلسة: نقطة لكل سؤال، تُملأ بلون من كسبه. */
function renderTrack(s) {
  const track = $('#mn-track');
  const total = s.progress.questions;
  const sig = `${total}:${s.progress.question}:${s.status}`;
  if (track.dataset.sig === sig) return;      // بثٌّ لا يغيّر المسار لا يعيد رسمه
  track.dataset.sig = sig;

  const at = s.status === 'round' ? s.progress.question : 0;
  track.innerHTML = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    return `<i class="${n < at ? 'past' : n === at ? 'now' : ''}"></i>`;
  }).join('');
}

/* ─────────── إعلان المستوى ─────────── */

let announcedLevel = null;

/** لافتةٌ تعبر قبل أول سؤال في كل مستوى — فيعرف اللاعب أن القواعد تغيّرت. */
function maybeAnnounceLevel(s) {
  if (s.phase !== 'ask' || s.progress.inLevel !== 1) return;
  if (announcedLevel === s.level.id) return;          // بثٌّ مكرَّر لا يعيدها
  announcedLevel = s.level.id;

  const box = $('#mn-banner');
  $('#mn-banner-num').textContent = `المستوى ${arNum(s.progress.level)}`;
  $('#mn-banner-name').textContent = s.level.name;
  $('#mn-banner-brief').textContent = s.level.brief;
  $('#mn-banner-points').textContent = `${points(s.level.points)} للإصابة`;

  box.hidden = false;
  void box.offsetWidth;                 // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
  box.classList.add('is-open');
  sfx.level();

  const linger = reducedMotion() ? 900 : 1700;
  setTimeout(() => {
    box.classList.remove('is-open');
    setTimeout(() => { box.hidden = true; }, 420);
  }, linger);
}

/* ─────────── لوح السؤال ─────────── */

/** توقيع السؤال المعروض — لا يُعاد رسم اللوح على كل بثّ فتضيع الحركة. */
let painted = null;

function renderBoard(s, prev) {
  const q = s.question;
  if (!q) return;
  const sig = `${s.progress.question}:${q.level}`;
  const fresh = painted !== sig;
  if (fresh) { painted = sig; awaitingAnswer = false; }

  hide($('#mn-pair')); hide($('#mn-relations')); hide($('#mn-hunt')); hide($('#mn-intruder'));

  if (q.level === 'pair') return renderPair(s, q, fresh);
  if (q.level === 'hunt') return renderHunt(s, q, fresh);
  return renderIntruder(s, q, fresh);
}

const LINK_GLYPH = { synonym: '=', antonym: '×', none: '—' };

function renderPair(s, q, fresh) {
  const board = $('#mn-pair');
  const rels = $('#mn-relations');
  const revealed = s.phase === 'reveal';

  $('#mn-word-a').textContent = q.a;
  $('#mn-word-b').textContent = q.b;

  if (fresh) {
    rels.innerHTML = q.relations
      .map((r, i) => `<button class="rel-btn" type="button" data-choice="${r.id}" style="--i:${i}">
          <span class="rel-glyph">${esc(r.glyph)}</span><strong>${esc(r.label)}</strong>
        </button>`)
      .join('');
    rels.querySelectorAll('.rel-btn').forEach((b) => {
      b.addEventListener('click', () => choose(b.dataset.choice, b));
    });
    board.classList.remove('enter');
    void board.offsetWidth;
    board.classList.add('enter');       // الكلمتان تنزلقان من الطرفين وتلتقيان
    sfx.deal();
  }

  // العلاقة على اللوح كله: الوصل يقرّب الكلمتين، والتضاد يدفعهما
  if (revealed) board.dataset.rel = s.solution.answer;
  else delete board.dataset.rel;
  $('#mn-link-glyph').textContent = revealed ? LINK_GLYPH[s.solution.answer] ?? '؟' : '؟';

  rels.querySelectorAll('.rel-btn').forEach((b) => {
    const mine = s.myAnswer?.choice === b.dataset.choice;
    b.classList.toggle('mine', Boolean(mine));
    b.classList.toggle('right', revealed && b.dataset.choice === s.solution.answer);
    b.classList.toggle('wrong', revealed && mine && !s.myAnswer.correct);
    b.disabled = revealed || Boolean(s.myAnswer);
  });

  reveal(board);
  reveal(rels);
}

function renderHunt(s, q, fresh) {
  const board = $('#mn-hunt');
  const grid = $('#mn-grid');
  const revealed = s.phase === 'reveal';

  $('#mn-hunt-ask').innerHTML = q.mode === 'synonym'
    ? `التقط <b>مرادف</b> كلمة <span class="mn-target">${esc(q.word)}</span>`
    : `التقط <b>ضدّ</b> كلمة <span class="mn-target">${esc(q.word)}</span>`;

  if (fresh) {
    grid.innerHTML = q.grid
      .map((w, i) => `<button class="word-chip" type="button" data-choice="${esc(w)}" style="--i:${i}">${esc(w)}</button>`)
      .join('');
    const chips = [...grid.querySelectorAll('.word-chip')];
    chips.forEach((c, i) => {
      // توزيعٌ متتابع: الشبكة تُرصف أمامه لا تظهر دفعةً واحدة
      if (reducedMotion()) c.classList.add('dealt');
      else setTimeout(() => { c.classList.add('dealt'); if (i % 3 === 0) sfx.deal(); }, 34 * i);
      c.addEventListener('click', () => choose(c.dataset.choice, c));
    });
  }

  grid.querySelectorAll('.word-chip').forEach((c) => {
    const mine = s.myAnswer?.choice === c.dataset.choice;
    c.classList.toggle('mine', Boolean(mine));
    c.classList.toggle('right', revealed && c.dataset.choice === s.solution.answer);
    c.classList.toggle('wrong', revealed && mine && !s.myAnswer.correct);
    c.classList.toggle('faded', revealed && c.dataset.choice !== s.solution.answer && !mine);
    c.disabled = revealed || Boolean(s.myAnswer);
  });

  reveal(board);
}

function renderIntruder(s, q, fresh) {
  const board = $('#mn-intruder');
  const wrap = $('#mn-words');
  const revealed = s.phase === 'reveal';

  if (fresh) {
    wrap.innerHTML = q.words
      .map((w, i) => `<button class="word-slab pick" type="button" data-choice="${esc(w)}" style="--i:${i}">${esc(w)}</button>`)
      .join('');
    const slabs = [...wrap.querySelectorAll('.word-slab')];
    slabs.forEach((c, i) => {
      if (reducedMotion()) c.classList.add('dealt');
      else setTimeout(() => { c.classList.add('dealt'); sfx.deal(); }, 70 * i);
      c.addEventListener('click', () => choose(c.dataset.choice, c));
    });
  }

  wrap.querySelectorAll('.word-slab').forEach((c) => {
    const isIntruder = revealed && c.dataset.choice === s.solution.answer;
    const mine = s.myAnswer?.choice === c.dataset.choice;
    c.classList.toggle('mine', Boolean(mine));
    c.classList.toggle('right', isIntruder);          // الدخيلة تنفصل عن الصفّ
    c.classList.toggle('wrong', revealed && mine && !s.myAnswer.correct);
    c.classList.toggle('family', revealed && !isIntruder);   // الخمس تتقارب
    c.disabled = revealed || Boolean(s.myAnswer);
  });

  reveal(board);
}

/** إجابةٌ واحدة لكل لاعب في السؤال — الضغط يُقفل اللوح فوراً لا بعد ردّ الخادم. */
function choose(choice, el) {
  if (awaitingAnswer || view?.phase !== 'ask' || view?.myAnswer) return;
  awaitingAnswer = true;
  el.classList.add('picked');
  send('maani-answer', { choice });
}

/* ─────────── حالة اللاعبين ─────────── */

function renderStatuses(s) {
  const revealed = s.phase === 'reveal';
  const meOut = Boolean(s.myAnswer) && !revealed;

  $('#mn-me-state').textContent = revealed
    ? (s.myAnswer?.correct ? 'أصبتَ' : s.myAnswer ? 'أخطأتَ' : 'لم تُجب')
    : meOut ? 'خرجتَ من السؤال' : 'دورك';

  $('#mn-opp-state').textContent = !s.opponent ? ''
    : revealed ? (s.oppAnswer?.correct ? 'أصاب' : s.oppAnswer ? 'أخطأ' : 'لم يُجب')
      : s.oppAnswered ? 'خرج من السؤال' : 'يفكّر…';

  const wait = $('#mn-wait');
  if (meOut) {
    // من أخطأ لا يبقى أمام لوحٍ ميت بلا خبر
    $('#mn-wait-text').textContent = s.oppAnswered
      ? 'أخطأتما معاً — يُكشف الجواب…'
      : 'أخطأتَ — الميدان لخصمك الآن';
    reveal(wait);
  } else if (!revealed && s.oppAnswered) {
    $('#mn-wait-text').textContent = 'أخطأ خصمك — خلا لك الميدان';
    reveal(wait);
  } else {
    hide(wait);
  }
}

/* ─────────── الكشف ─────────── */

function renderVerdict(s, prev) {
  const box = $('#mn-verdict');
  if (s.phase !== 'reveal') { hide(box); return; }

  const sol = s.solution;
  const iWon = sol.winnerId === s.me?.id;
  const nobody = !sol.winnerId;

  $('#mn-verdict-mark').textContent = nobody ? '—' : iWon ? '✓' : '✕';
  $('#mn-verdict-mark').className = `mn-verdict-mark ${nobody ? 'none' : iWon ? 'win' : 'lose'}`;
  $('#mn-verdict-title').textContent = nobody
    ? 'أخطأتما معاً — لا نقاط'
    : iWon ? 'أصبتَ وسبقتَه' : 'سبقك خصمك';
  $('#mn-verdict-why').textContent = sol.why;
  $('#mn-gain').textContent = nobody ? '—' : `${iWon ? 'لك' : 'له'} ${points(sol.points)}`;
  $('#mn-gain').classList.toggle('mine', iWon);

  reveal(box);

  // بعد ظهور البطاقة: النقاط تطير منها إلى لوح الفائز ثم يعدّ الرقم
  if (prev?.phase !== 'reveal') {
    if (reducedMotion()) paintScores(s);
    else laterCancellable(() => paintScores(s, { animate: true }), 340);
  }
}

/* ─────────── لوح النقاط ─────────── */

/** ما هو معروض الآن — يتخلّف عن الحالة أثناء الانميشن. */
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
  for (const [sel, id] of [['#mn-me-score', s.me?.id], ['#mn-opp-score', s.opponent?.id]]) {
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
  const a = $('#mn-gain').getBoundingClientRect();
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
  }, 600);
}

/** يعدّ الرقم تصاعدياً بالوقت لا بـ rAF (الأخير لا يعمل في تبويب خلفي). */
function countUp(node, from, to, id, { cancellable = true } = {}) {
  const started = Date.now();
  const dur = 480;
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

let finaleShown = false;

const FINALE = {
  win: { mark: '✦', title: 'أنت أسرعُ لساناً', line: 'سبقتَه إلى المعنى قبل أن يبلغه.' },
  lose: { mark: '✕', title: 'سبقك خصمك', line: 'كانت المعاني أقربَ إليه منك.' },
  tie: { mark: '=', title: 'تعادلتما', line: 'لسانان لا يفترقان.' },
};

function renderOver(s) {
  for (const id of ['#mn-level', '#mn-pair', '#mn-relations', '#mn-hunt',
                    '#mn-intruder', '#mn-verdict', '#mn-wait']) hide($(id));

  const me = s.scores[s.me.id] ?? 0;
  const opp = s.scores[s.opponent?.id] ?? 0;
  const outcome = s.winnerId === null ? 'tie' : (s.winnerId === s.me.id ? 'win' : 'lose');

  $('#mn-over-title').textContent = FINALE[outcome].title;
  $('#mn-over-score').textContent = `${s.me.name}: ${me} — ${s.opponent?.name ?? ''}: ${opp}`;
  reveal($('#mn-over'));

  if (!finaleShown) { finaleShown = true; playFinale(s, outcome, me, opp); }
}

/** مشهد الختام — يشارك سَنَد طبقتَه نفسها، فالنهاية واحدة في الديوان. */
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

export function bindMaaniUI() {
  // ربطٌ آمن: عنصرٌ مفقود لا يُسقط الشاشة كلها قبل أن تتصل
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, fn);

  on('#mn-start', 'click', () => send('maani-start'));
  on('#mn-next', 'click', () => send('maani-next'));
  on('#mn-copy-link', 'click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#mn-invite-link').value);
      e.target.textContent = 'نُسخ ✓';
    } catch {
      $('#mn-invite-link').select();
      e.target.textContent = 'انسخه يدوياً';
    }
    setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1800);
  });

  // طبقة الختام مشتركة مع سَنَد: تُربط مرة واحدة مهما دخلت اللعبتان
  const finale = $('#finale');
  if (finale && !finale.dataset.closeBound) {
    finale.dataset.closeBound = '1';
    on('#finale-close', 'click', () => {
      finale.classList.remove('is-open');
      setTimeout(() => { finale.hidden = true; }, 420);
    });
  }
}
