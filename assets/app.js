/**
 * ديوان التحدي — التنقل بين الشاشات، واختيار اللعبة أو **مباراة جولات**.
 *
 * المباراة: عدّة ألعاب في ديوانٍ واحد، فائزُ كلٍّ يأخذ وعاءً ثابتاً. الخادم
 * يبدّل لعبة الغرفة ويرسل `match-switch`، فيغلق هذا الملفُّ مقبسَ اللعبة
 * المنقضية ويدخل التالية بمعرّف اللاعب نفسه — فيستعيد مقعده لا مقعداً شاغراً.
 */

import * as Trial from './trial.js';
import * as Sanad from './sanad.js';
import * as Maani from './maani.js';
import * as ManAna from './man-ana.js';
import * as Mazad from './mazad.js';

/** كل لعبة مبنيّة وواجهتُها: الوحدة، شاشتها، وحقل رمز الديوان فيها. */
const GAME_UI = {
  muhakama: { mod: Trial, screen: 'screen-trial', code: '#trial-code', bind: Trial.bindTrialUI },
  sanad: { mod: Sanad, screen: 'screen-sanad', code: '#sanad-code', bind: Sanad.bindSanadUI },
  maani: { mod: Maani, screen: 'screen-maani', code: '#maani-code', bind: Maani.bindMaaniUI },
  'man-ana': { mod: ManAna, screen: 'screen-man-ana', code: '#man-ana-code', bind: ManAna.bindManAnaUI },
  mazad: { mod: Mazad, screen: 'screen-mazad', code: '#mazad-code', bind: Mazad.bindMazadUI },
};

const BUILT = Object.keys(GAME_UI);

const state = {
  mode: 'create',   // 'create' | 'join'
  name: '',
  code: '',
  playerId: null,
  gameId: null,     // معرّف اللعبة أو 'random'
  picks: [],        // ألعاب المباراة بالترتيب — واحدة يعني لعبةً مفردة
  active: null,     // اللعبة المعروضة الآن
};

const $ = (sel) => document.querySelector(sel);

/** انفجار معلقات من موضع العنصر الذي ضُغط. */
function burstFrom(el, count) {
  const r = el.getBoundingClientRect();
  window.Diwan?.burst(r.left + r.width / 2, r.top + r.height / 2, count);
}

/* ---------- التنقل بين الشاشات ---------- */

function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
  $('#' + screenId).classList.add('is-active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- شاشة البدء ---------- */

function refreshStartButton() {
  const nameOk = $('#player-name').value.trim().length >= 2;
  const codeOk = state.mode === 'create' || $('#room-code').value.trim().length === 4;
  $('#btn-start').disabled = !(nameOk && codeOk);
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  });
  $('#code-field').hidden = mode !== 'join';
  $('#btn-start').textContent = mode === 'create' ? 'ابدأ' : 'ادخل الديوان';
  $('#start-hint').textContent = mode === 'create'
    ? 'كل لاعب يفتح اللعبة من جهازه — واحد ينشئ الديوان ويرسل الرمز، والثاني ينضم به.'
    : 'اطلب الرمز من صاحبك الذي أنشأ الديوان، وأدخله هنا لتنضم إلى نفس المبارزة.';
  refreshStartButton();
}

/* ---------- بطاقات الألعاب ---------- */

function heatMarks(level) {
  return '<b>' + '◆'.repeat(level) + '</b>' + '◇'.repeat(3 - level);
}

function gameCard(g) {
  return `
    <button class="card" type="button" data-id="${g.id}" aria-pressed="false">
      <span class="check">✓</span>
      <span class="order" aria-hidden="true"></span>
      <div class="glyph">${g.glyph}</div>
      <h3>${g.name}</h3>
      <p class="tagline">${g.tagline}</p>
      <p class="desc">${g.desc}</p>
      <div class="meta">
        ${g.tags.map((t) => `<span class="tag">${t}</span>`).join('')}
        <span class="heat" title="مستوى الشراسة">${heatMarks(g.heat)}</span>
      </div>
      <p class="duration">${g.duration}</p>
    </button>`;
}

function randomCard() {
  return `
    <button class="card random" type="button" data-id="random" aria-pressed="false">
      <span class="check">✓</span>
      <span class="order" aria-hidden="true"></span>
      <div class="glyph">✦</div>
      <h3>نصيبك من الديوان</h3>
      <p class="tagline">خلّها على الحكم</p>
      <p class="desc">لا تختار شيئاً — الوكيل ينتقي اللعبة بنفسه ولا يكشفها إلا لحظة البدء.</p>
      <div class="meta">
        <span class="tag">عشوائي</span>
        <span class="tag">مفاجأة</span>
        <span class="heat" title="مستوى الشراسة">؟؟؟</span>
      </div>
      <p class="duration">حسب اللعبة المختارة</p>
    </button>`;
}

function renderGames() {
  $('#games-grid').innerHTML = GAMES.map(gameCard).join('') + randomCard();

  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => {
      burstFrom(card, 8);
      toggleGame(card.dataset.id);
    });
  });
}

const nameOfGame = (id) => (id === 'random'
  ? 'نصيبك من الديوان'
  : GAMES.find((g) => g.id === id)?.name ?? id);

/**
 * الاختيار **تراكمي**: ضغطةٌ تضيف اللعبة إلى المباراة وأخرى تسحبها، والترتيب
 * ترتيبُ الضغط. و«نصيبك من الديوان» تُفرِد نفسها — مفاجأةٌ لا تُصفّ في جولات.
 */
function toggleGame(id) {
  if (id === 'random' || !BUILT.includes(id)) {
    // العشوائيّ وبطاقاتُ العرض غير المبنيّة تُفرِد نفسها: الخادم لا يعرفها
    // فيُسقطها من المباراة، فإعلانُها جولةً وعدٌ لا يُوفى
    state.picks = state.picks.includes(id) ? [] : [id];
  } else {
    const picks = state.picks.filter((p) => BUILT.includes(p));
    state.picks = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
    if (state.picks.length > MAX_MATCH) state.picks = state.picks.slice(-MAX_MATCH);
  }
  paintPicks();
}

const MAX_MATCH = 5;

function paintPicks() {
  document.querySelectorAll('.card').forEach((c) => {
    const at = state.picks.indexOf(c.dataset.id);
    c.setAttribute('aria-pressed', String(at >= 0));
    const order = c.querySelector('.order');
    // مباراةٌ من واحدة ليست مباراة، فلا يُرقَّم اختيارٌ مفرد
    if (order) order.textContent = at >= 0 && state.picks.length > 1 ? arNum(at + 1) : '';
  });

  const n = state.picks.length;
  const label = $('#pick-label');
  if (!n) {
    label.innerHTML = 'اختر لعبة — أو عدّة ألعاب فتصير مباراة جولات';
  } else if (n === 1) {
    label.innerHTML = `اخترت: <b>${nameOfGame(state.picks[0])}</b>`;
  } else {
    label.innerHTML = `مباراة من <b>${arNum(n)} جولات</b>: ${
      state.picks.map((p) => nameOfGame(p)).join(' ← ')}`;
  }
  // مباراةٌ لا تُبنى إلا من الألعاب المبنيّة، فلا تُرقَّم بطاقةُ عرضٍ كأنها جولة
  $('#pick-hint').hidden = n !== 1 || BUILT.includes(state.picks[0]) || state.picks[0] === 'random';
  $('#btn-confirm').textContent = n > 1 ? 'ابدأ المباراة' : 'ابدأ';
  $('#btn-confirm').disabled = n === 0;
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n) => String(n).split('').map((d) => AR_DIGITS[+d] ?? d).join('');

/* ---------- شاشة الاستعداد (للألعاب غير المبنيّة) ---------- */

function openLobby() {
  const id = state.picks[0];
  const g = id === 'random'
    ? { name: 'نصيبك من الديوان', desc: 'اللعبة مخفيّة — يكشفها الحكم عند البدء.', glyph: '✦' }
    : GAMES.find((x) => x.id === id);

  $('#lobby-glyph').textContent = g.glyph;
  $('#lobby-title').textContent = g.name;
  $('#lobby-desc').textContent = g.desc;
  $('#lobby-code').textContent = state.code;
  show('screen-lobby');
}

/* ---------- الدخول إلى لعبة ---------- */

let live = null;              // اللعبة الموصولة الآن (مقبسٌ مفتوح)
const bound = new Set();      // ما رُبطت واجهتُه — الربط مرّةً لا مرّتين

/**
 * يفتح شاشة لعبةٍ ويصلها بالخادم. **حارس `live`** يمنع مقبساً ثانياً على
 * اللعبة نفسها (تسرّبٌ وتضاعفُ أزرار)، لكنه يسمح بتبديل الجولة: تلك تغلق
 * مقبسها أولاً بـ `leave()`.
 */
function enterGame(id, { resume = false } = {}) {
  const ui = GAME_UI[id];
  if (!ui) { openLobby(); return; }

  state.active = id;
  if (live === id) { show(ui.screen); return; }
  live = id;
  if (!bound.has(id)) { bound.add(id); ui.bind(); }
  ui.mod.connect({
    mode: resume ? 'join' : state.mode,
    name: state.name,
    code: state.code,
    playerId: state.playerId,
    games: state.picks.filter((p) => BUILT.includes(p)),
    onJoined: ({ code, playerId, game }) => {
      state.code = code;
      state.playerId = playerId ?? state.playerId;
      // الخادم يوجّهنا إلى جولة المباراة الجارية؛ رابطُ دعوةٍ يحمل لعبةً انقضت
      // جولتُها يُدخل صاحبَه بواجهةٍ ترسم حالةَ لعبةٍ أخرى
      if (game && game !== id && GAME_UI[game]) {
        GAME_UI[id].mod.leave?.();
        live = null;
        enterGame(game, { resume: true });
        return;
      }
      $(ui.code).textContent = code;
      $('#chip-code').textContent = code;
      paintSession();
      show(ui.screen);
    },
    onSwitch: (next) => { live = null; enterGame(next, { resume: true }); },
    onError: (err) => {
      if (!$('#' + ui.screen).classList.contains('is-active')) live = null;
      window.alert(err);
    },
  });
}

/** يترك الديوان ويعود للرئيسية — المقبس يُغلق فلا يبقى مقعدٌ محجوز. */
function goHome() {
  closeFinale();                      // طبقةٌ ثابتة تبقى فوق الرئيسية تبتلع كل نقر
  if (live) GAME_UI[live]?.mod.leave?.();
  live = null;
  seen = null;
  document.body.classList.remove('playing');
  state.active = null;
  state.code = '';
  state.playerId = null;
  state.picks = [];
  paintPicks();
  paintSession();
  $('#chip-code').textContent = '—';
  show('screen-start');
}

/** يُغلق طبقة الختام المشتركة — تُستدعى قبل كل مغادرةٍ للميدان. */
function closeFinale() {
  const f = $('#finale');
  if (!f) return;
  f.classList.remove('is-open');
  f.hidden = true;
}

/* ---------- لوحة الجلسة ---------- */

/**
 * لوحٌ جانبيّ **قبل اللعب وحده** (قرار مستخدم صريح): الحاضرون والرمز ورابط
 * الدعوة. و«قبل اللعب» هنا يعني **قبل أن تبدأ الجلسة فعلاً** لا قبل ظهور شاشة
 * اللعبة: المُنشئ يدخل الميدان فوراً وينتظر خصمه فيه، فلو حُجب اللوح عن كل
 * شاشات الألعاب لما رآه صاحب الدعوة أصلاً — وهو أوّل من يحتاجه.
 *
 * والحاضرون يُقرأون من الحالة المبثوثة لا يُخمَّنون: لوحةٌ تقول «بانتظار خصمك»
 * وخصمُه جالسٌ معه أسوأ من ألّا تكون.
 */
let seen = null;              // آخر لقطة حالة وصلت من أي لعبة

function paintSession() {
  const has = Boolean(state.code);
  $('#ses-code').textContent = state.code || '—';
  const game = state.active ?? state.picks[0];
  $('#ses-link').value = has
    ? `${location.origin}/?code=${state.code}${game ? `&game=${game}` : ''}` : '';
  $('#ses-invite').hidden = !has;

  const me = seen?.me?.name || state.name || 'أنت';
  const opp = seen?.opponent?.name;
  const rows = [`<li class="ses-person is-me"><b>${esc(me)}</b><span>أنت</span></li>`];
  if (!has) {
    rows.push(`<li class="ses-person waiting"><b>لا ديوان بعد</b><span>ابدأ أو ادخل برمز</span></li>`);
  } else if (opp) {
    const on = seen.opponent.connected !== false;
    rows.push(`<li class="ses-person${on ? '' : ' waiting'}"><b>${esc(opp)}</b>
      <span>${on ? 'حاضر' : 'انقطع — قد يعود'}</span></li>`);
  } else {
    rows.push(`<li class="ses-person waiting"><b>بانتظار خصمك…</b><span>أرسل له الرابط</span></li>`);
  }
  $('#ses-people').innerHTML = rows.join('');
}

/**
 * تُستدعى من كل وحدة عند كل بثّ حالة: تحدّث شريط المباراة، ولوحَ الجلسة،
 * وتُظهر زرّ الجلسة أو تخفيه بحسب **هل بدأت الجلسة فعلاً**.
 */
function onState(st) {
  seen = st;
    document.body.classList.toggle('playing', st?.status && st.status !== 'lobby');
  paintMatch(st?.match ?? null);
  if (!$('#session-panel').hidden) paintSession();
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let sesHide = null;

function toggleSession(open) {
  const panel = $('#session-panel');
  const want = open ?? panel.hidden;
  clearTimeout(sesHide);                 // إخفاءٌ مؤجَّل من إغلاقٍ سابق لا يطفئ فتحاً جديداً
  if (want) {
    paintSession();
    panel.hidden = false;
    void panel.offsetWidth;              // إعادة تدفّق: rAF لا يعمل في تبويب خلفي
    panel.classList.add('is-open');
  } else {
    panel.classList.remove('is-open');
    // بمؤقّتٍ لا بـ `transitionend`: من قلّل الحركة لا انتقالَ عنده فلا حدث،
    // فتبقى الطبقة (inset:0) شفافةً تبتلع كل نقرةٍ في الصفحة إلى الأبد
    sesHide = setTimeout(() => { panel.hidden = true; }, reducedMotion() ? 0 : 240);
  }
  document.body.classList.toggle('ses-open', want);
  $('#session-btn').setAttribute('aria-expanded', String(want));
}

/* ---------- شريط المباراة وذيل الختام ---------- */

/**
 * شريطٌ نحيل في رأس الميدان: أيّ جولةٍ نحن فيها وكم في الوعاء. **عنصرٌ واحد
 * يُنقَل** بين رؤوس الشاشات بدل خمس نسخ في الترميز — فلا يشيخ أربعةٌ منها حين
 * يُعدَّل الخامس.
 */
let strip = null;

function matchStrip() {
  if (strip) return strip;
  strip = document.createElement('div');
  strip.className = 'match-strip';
  strip.innerHTML = `
    <span class="ms-round" id="ms-round"></span>
    <span class="ms-dots" id="ms-dots"></span>
    <span class="ms-pot"><b id="ms-me">0</b><i>الوعاء</i><b id="ms-opp">0</b></span>
    <button class="btn btn-primary btn-sm ms-act" type="button" id="ms-next" hidden></button>
    <button class="btn btn-ghost btn-sm ms-act" type="button" id="ms-home" hidden data-home>الرئيسية</button>`;
  strip.querySelector('#ms-next').addEventListener('click', (e) => {
    burstFrom(e.currentTarget, 12);
    closeFinale();
    window.Diwan.matchNext();
  });
  // الشريط يُنشَأ بعد DOMContentLoaded، فلا يلتقطه ربطُ [data-home] هناك
  strip.querySelector('#ms-home').addEventListener('click', () => goHome());
  return strip;
}

/** تُستدعى من كل وحدة عند كل بثّ حالة — `null` يعني لعبةً مفردة لا مباراة. */
function paintMatch(m) {
  const el = matchStrip();
  if (!m) { el.remove(); paintFinaleMatch(null); return; }

  const screen = GAME_UI[state.active]?.screen;
  const head = screen ? $('#' + screen)?.querySelector('.topbar') : null;
  if (head && el.parentElement !== head) head.appendChild(el);

  $('#ms-round').textContent = `الجولة ${arNum(m.roundNo)} من ${arNum(m.total)}`;
  $('#ms-dots').innerHTML = m.games.map((g, i) => {
    const r = m.results[i];
    const cls = r ? (r.tie ? 'tie' : r.iWon ? 'won' : 'lost') : (i === m.idx ? 'now' : '');
    return `<i class="ms-dot ${cls}" title="${esc(nameOfGame(g))}"></i>`;
  }).join('');
  $('#ms-me').textContent = m.myPot;
  $('#ms-opp').textContent = m.oppPot;

  // الجولة حُسمت؟ الطريقُ إلى التالية (أو إلى الرئيسية) ظاهرٌ في الشريط نفسه،
  // فلا يتوقّف على طبقة ختامٍ قد لا تفتحها اللعبة أصلاً
  // طبقةُ الختام مفتوحةٌ فوق الشريط؟ أزرارُها هي الطريق، وأزرارُ الشريط تحتها
  // تبدو قابلةً للنقر وليست كذلك. فطريقٌ واحدٌ ظاهرٌ في كل لحظة لا طريقان.
  const veiled = !$('#finale')?.hidden;
  const settled = m.over || m.results.length > m.idx;
  const next = $('#ms-next');
  next.hidden = veiled || !settled || m.over;
  next.textContent = `الجولة التالية: ${nameOfGame(m.games[m.idx + 1] ?? '')}`;
  $('#ms-home').hidden = veiled || !m.over;
  paintFinaleMatch(m);
}

/**
 * ذيل طبقة الختام: نتيجة الجولة وزرّ اللعبة التالية. الزرّ يظهر **بعد آخر
 * جولةٍ انتهت وقبل أن تُستهلك المباراة**، فلا يُعرض على لعبةٍ لمّا تنتهِ.
 */
function paintFinaleMatch(m) {
  const box = $('#finale-match');
  const next = $('#finale-next');
  if (!box || !next) return;
  if (!m) { box.hidden = true; next.hidden = true; return; }
  // الجولة تُحسم حين تُسجَّل نتيجتها؛ قبل ذلك لا نكتب «انتهت» عن جولةٍ تجري
  if (!(m.over || m.results.length > m.idx)) { box.hidden = true; next.hidden = true; return; }

  box.hidden = false;
  $('#finale-round').textContent = m.over
    ? (m.tied ? 'انتهت المباراة بالتعادل' : m.iLead ? 'المباراة لك' : 'المباراة له')
    : `انتهت الجولة ${arNum(m.roundNo)} من ${arNum(m.total)}`;
  $('#finale-pot').innerHTML = `
    <span class="fp-side${m.iLead && m.over ? ' lead' : ''}"><b>${m.myPot}</b><i>أنت</i></span>
    <span class="fp-vs">×</span>
    <span class="fp-side"><b>${m.oppPot}</b><i>خصمك</i></span>`;
  next.hidden = m.over || m.results.length <= m.idx;
  next.textContent = `الجولة التالية: ${nameOfGame(m.games[m.idx + 1] ?? '')}`;
}

/**
 * طبقةُ الختام تُفتح وتُغلق من داخل وحدات الألعاب، فنراقب سمة `hidden` عليها
 * لنُعيد رسم الشريط عندها — وإلا بقيت أزرارُه مخفيّةً بعد إغلاقها أو ظاهرةً
 * تحتها وهي مفتوحة.
 */
function watchFinale() {
  const f = $('#finale');
  if (!f) return;
  new MutationObserver(() => paintMatch(seen?.match ?? null))
    .observe(f, { attributes: true, attributeFilter: ['hidden'] });
}

/* ---------- الربط ---------- */

document.addEventListener('DOMContentLoaded', () => {
  renderGames();
  watchFinale();
  paintPicks();

  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => setMode(t.dataset.mode));
  });

  $('#player-name').addEventListener('input', refreshStartButton);
  $('#room-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    refreshStartButton();
  });

  $('#btn-start').addEventListener('click', (e) => {
    burstFrom(e.currentTarget, 18);
    state.name = $('#player-name').value.trim();
    // رمز الإنشاء يصدره الخادم وحده؛ الاختراع محلياً يعطي المُنشئ رمزاً لا وجود له
    state.code = state.mode === 'create' ? '' : $('#room-code').value.trim();

    $('#chip-code').textContent = state.code || '—';
    $('#p1-name').textContent = state.name;
    $('#p1-avatar').textContent = state.name[0] || '؟';
    paintSession();

    // دعوةٌ تحمل لعبتها: ندخلها مباشرة، فاختيار غيرها يدخله بواجهة لا تخصّه
    if (GAME_UI[state.invitedGame]) {
      state.picks = [state.invitedGame];
      enterGame(state.invitedGame);
      return;
    }
    show('screen-games');
  });

  $('#btn-confirm').addEventListener('click', (e) => {
    burstFrom(e.currentTarget, 16);
    enterGame(state.picks[0]);
  });
  $('#btn-back').addEventListener('click', () => show('screen-start'));
  $('#btn-change-game').addEventListener('click', () => show('screen-games'));

  $('#btn-copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(state.code);
      e.target.textContent = 'تم النسخ ✓';
      setTimeout(() => { e.target.textContent = 'نسخ الرمز'; }, 1600);
    } catch {
      e.target.textContent = 'انسخه يدوياً';
    }
  });

  /* لوحة الجلسة */
  $('#finale-next').addEventListener('click', (e) => {
    burstFrom(e.currentTarget, 14);
    $('#finale').classList.remove('is-open');
    $('#finale').hidden = true;
    window.Diwan.matchNext();
  });

  $('#session-btn').addEventListener('click', () => toggleSession());
  $('#ses-close').addEventListener('click', () => toggleSession(false));
  $('#ses-home').addEventListener('click', () => { toggleSession(false); goHome(); });
  $('#ses-copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText($('#ses-link').value);
      e.target.textContent = 'نُسخ ✓';
      setTimeout(() => { e.target.textContent = 'انسخ الرابط'; }, 1600);
    } catch { e.target.textContent = 'انسخه يدوياً'; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#session-panel').hidden) toggleSession(false);
  });

  // الخروج للرئيسية من أي ميدان — يُغلق المقبس فلا يبقى مقعدٌ محجوز
  document.querySelectorAll('[data-home]').forEach((b) => {
    b.addEventListener('click', () => goHome());
  });
  paintSession();

  // رابط دعوة ?code=ABCD — الخصم يفتحه فيجد الرمز مملوءاً
  const params = new URLSearchParams(location.search);
  const invited = params.get('code');
  const invitedGame = params.get('game');
  if (invited) {
    setMode('join');
    state.invitedGame = invitedGame;
    $('#room-code').value = invited.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    $('#start-hint').textContent = 'دُعيتَ إلى ديوان — اكتب اسمك وادخل.';
  } else {
    setMode('create');
  }
  refreshStartButton();
});

// «الجولة التالية» في نهاية اللعبة يرسلها أيُّ الطرفين — الخادم يبدّل للاثنين
window.Diwan = window.Diwan ?? {};
window.Diwan.matchNext = () => GAME_UI[state.active]?.mod.sendMatchNext?.();
window.Diwan.onState = onState;
window.Diwan.goHome = goHome;
