/**
 * ديوان التحدي — التنقل بين الشاشات واختيار اللعبة.
 *
 * «المحاكمة» موصولة بالخادم عبر assets/trial.js؛ بقية الألعاب لم تُبنَ بعد
 * وتقف عند شاشة الاستعداد.
 */

import { connect, bindTrialUI, startTrial } from './trial.js';

/** معرّف لعبة المحاكمة في كتالوج GAMES. */
const TRIAL_ID = 'muhakama';

const state = {
  mode: 'create',   // 'create' | 'join'
  name: '',
  code: '',
  gameId: null,     // معرّف اللعبة أو 'random'
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
      selectGame(card.dataset.id);
    });
  });
}

function selectGame(id) {
  state.gameId = id;
  document.querySelectorAll('.card').forEach((c) => {
    c.setAttribute('aria-pressed', String(c.dataset.id === id));
  });

  const picked = id === 'random' ? 'نصيبك من الديوان' : GAMES.find((g) => g.id === id).name;
  $('#pick-label').innerHTML = `اخترت: <b>${picked}</b>`;
  $('#btn-confirm').disabled = false;
}

/* ---------- شاشة الاستعداد ---------- */

function openLobby() {
  const g = state.gameId === 'random'
    ? { name: 'نصيبك من الديوان', desc: 'اللعبة مخفيّة — يكشفها الحكم عند البدء.', glyph: '✦' }
    : GAMES.find((x) => x.id === state.gameId);

  $('#lobby-glyph').textContent = g.glyph;
  $('#lobby-title').textContent = g.name;
  $('#lobby-desc').textContent = g.desc;
  $('#lobby-code').textContent = state.code;
  show('screen-lobby');
}

/* ---------- المحاكمة ---------- */

let trialConnected = false;

/** يفتح شاشة المحاكمة ويصل بالخادم — كل منطق اللعب هناك. */
function enterTrial() {
  if (trialConnected) { show('screen-trial'); return; }   // وإلا تسرّب مقبس وتضاعفت الأزرار
  trialConnected = true;
  bindTrialUI();
  connect({
    mode: state.mode,
    name: state.name,
    code: state.code,
    onJoined: ({ code }) => {
      state.code = code;
      $('#trial-code').textContent = code;
      show('screen-trial');
    },
    onError: (err) => {
      if (!$('#screen-trial').classList.contains('is-active')) trialConnected = false;
      window.alert(err);
    },
  });
}

/* ---------- الربط ---------- */

document.addEventListener('DOMContentLoaded', () => {
  renderGames();

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
    show('screen-games');
  });

  $('#btn-confirm').addEventListener('click', (e) => {
    burstFrom(e.currentTarget, 16);
    if (state.gameId === TRIAL_ID) enterTrial();
    else openLobby();
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

  setMode('create');
});
