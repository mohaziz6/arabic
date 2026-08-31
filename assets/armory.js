/**
 * خزانة الأسلحة — تفتح فتغطي المكان، وتُرمى منها بطاقة على الخصم.
 * الصوت مولّد بـ Web Audio: لا ملفات ولا موسيقى.
 */

import { cardArt } from './card-art.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** نصوص البطاقات والقيود يولّدها النموذج — لا تُحقن كـ HTML. */
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ─────────── الصوت ─────────── */

let audio = null;

function ctx() {
  if (!audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
  }
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function tone({ freq, dur, type = 'sine', gain = 0.1, slideTo }) {
  const ac = ctx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
  vol.gain.setValueAtTime(gain, ac.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(vol).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur);
}

/** ضجيج قصير — سحب معدن أو صفير هواء. */
function noise(dur = 0.22, gain = 0.09) {
  const ac = ctx();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2600, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(700, ac.currentTime + dur);
  const vol = ac.createGain();
  vol.gain.setValueAtTime(gain, ac.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  src.connect(filter).connect(vol).connect(ac.destination);
  src.start();
}

const sfx = {
  open: () => { noise(0.3, 0.07); tone({ freq: 200, slideTo: 520, dur: 0.26, type: 'triangle', gain: 0.08 }); },
  deal: () => tone({ freq: 340, slideTo: 150, dur: 0.13, type: 'triangle', gain: 0.08 }),
  hover: () => tone({ freq: 900, slideTo: 1200, dur: 0.05, type: 'sine', gain: 0.04 }),
  throw: () => { noise(0.34, 0.13); tone({ freq: 620, slideTo: 90, dur: 0.4, type: 'sawtooth', gain: 0.11 }); },
  hit: () => { tone({ freq: 110, slideTo: 45, dur: 0.5, gain: 0.2 }); setTimeout(() => tone({ freq: 300, slideTo: 160, dur: 0.6, gain: 0.07 }), 90); },
  denied: () => tone({ freq: 200, slideTo: 120, dur: 0.22, type: 'square', gain: 0.07 }),
};

export const armorySfx = sfx;

/* ─────────── الخزانة ─────────── */

let onPick = null;
let armoryOpen = false;

export const isArmoryOpen = () => armoryOpen;

/** يفتح الخزانة ببطاقات اللاعب. `hand` من لقطة الحالة. */
export async function openArmory(hand, { canThrow, reason, onThrow }) {
  const box = $('#armory');
  const deck = $('#armory-deck');
  onPick = onThrow;

  $('#armory-sub').textContent = canThrow
    ? 'يُرمى على خصمك فيصارعه أمام القاضي'
    : reason || 'لا يمكنك الرمي الآن';

  deck.innerHTML = hand
    .map(
      (c, i) => `
      <button class="armory-card ${c.spent ? 'spent' : ''}" type="button"
              data-id="${c.id}" style="--i:${i}" ${c.spent || !canThrow ? 'disabled' : ''}>
        ${cardArt(c.id)}
        <strong>${esc(c.name)}</strong>
        <small>${esc(c.brief)}</small>
        ${c.content ? `<em class="armory-content">${esc(c.content)}</em>` : ''}
        <span class="armory-mark">${c.spent ? 'مستهلك' : `+${Number(c.bonus)} / ${Number(c.penalty)}`}</span>
      </button>`,
    )
    .join('');

  box.hidden = false;
  armoryOpen = true;
  requestAnimationFrame(() => box.classList.add('is-open'));
  sfx.open();

  const cards = [...deck.querySelectorAll('.armory-card')];
  for (let i = 0; i < cards.length; i++) {
    setTimeout(() => { cards[i].classList.add('dealt'); sfx.deal(); }, 70 * i);
  }

  cards.forEach((el) => {
    el.addEventListener('mouseenter', () => { if (!el.disabled) sfx.hover(); });
    el.addEventListener('click', () => {
      if (el.disabled) { sfx.denied(); return; }
      el.classList.add('thrown');
      sfx.throw();
      setTimeout(() => { closeArmory(); onPick?.(el.dataset.id); }, 320);
    });
  });
}

export async function closeArmory() {
  const box = $('#armory');
  if (!armoryOpen) return;
  armoryOpen = false;
  box.classList.remove('is-open');
  await sleep(300);
  if (!armoryOpen) box.hidden = true;   // لا نخفِ فتحةً جديدة سبقت المهلة
}

/* ─────────── إعلان الرمية ─────────── */

/**
 * يعرض الرمية بوضوح: الهدف يرى أن سلاحاً أُشهر عليه، والرامي يرى أنه أصاب.
 */
let strikeToken = 0;

export async function showStrike({ cardId, name, onTarget, content, by, atMe }) {
  const box = $('#strike');
  const mine = ++strikeToken;          // رمية أحدث تُلغي مؤقّت الأقدم

  $('#strike-glyph').innerHTML = cardArt(cardId);
  $('#strike-title').textContent = atMe ? `${by} رمى عليك: ${name}` : `رميتَ: ${name}`;
  $('#strike-body').textContent = atMe
    ? `${onTarget ?? ''}${content ? `\n«${content}»` : ''}`
    : 'أُشهر السلاح — والقاضي يرقب.';

  box.classList.toggle('at-me', Boolean(atMe));
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('is-open'));
  sfx.hit();

  await sleep(atMe ? 3000 : 1900);
  if (mine !== strikeToken) return;    // حلّت محلّها رمية أخرى
  box.classList.remove('is-open');
  await sleep(340);
  if (mine === strikeToken) box.hidden = true;
}
