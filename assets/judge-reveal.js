/**
 * قرعة القاضي — ثلاث بطاقات تهبط، والنور يدور عليها كالروليت
 * حتى يستقر على قاضي الجلسة.
 *
 * الصوت مولّد بـ Web Audio لا ملفات ولا موسيقى: نقرة عند كل دورة،
 * ودقّة عميقة عند الاستقرار.
 */

import { judgeSilhouette } from './judge-art.js';

const $ = (s) => document.querySelector(s);

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

/** نغمة قصيرة — لبنة كل الأصوات هنا. */
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

const tick = () => tone({ freq: 1250, slideTo: 700, dur: 0.05, type: 'triangle', gain: 0.07 });
const thump = () => tone({ freq: 90, slideTo: 42, dur: 0.5, type: 'sine', gain: 0.22 });
const drop = () => tone({ freq: 320, slideTo: 130, dur: 0.16, type: 'triangle', gain: 0.1 });

/** دقّة المطرقة عند إعلان القاضي: ضربتان ورنين خافت. */
function gavel() {
  thump();
  setTimeout(thump, 150);
  setTimeout(() => tone({ freq: 520, slideTo: 300, dur: 0.9, type: 'sine', gain: 0.09 }), 300);
}

/* ─────────── الانميشن ─────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * يعرض القرعة ويستقر على `chosen`.
 * يُرجع وعداً ينتهي بعد أن يُعلَن القاضي ويُغلق الستار.
 */
export async function revealJudge(judges, chosen) {
  const overlay = $('#judge-draw');
  const deck = $('#judge-deck');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  deck.innerHTML = judges
    .map(
      (j, i) => `
      <div class="judge-card" data-id="${j.id}" style="--i:${i}">
        <div class="judge-card-inner">
          ${judgeSilhouette(j.id)}
          <div class="judge-meta">
            <strong>${j.name}</strong>
            <small>${j.epithet}</small>
          </div>
        </div>
      </div>`,
    )
    .join('');

  const cards = [...deck.querySelectorAll('.judge-card')];
  const winner = cards.find((c) => c.dataset.id === chosen) ?? cards[0];
  const winnerJudge = judges.find((j) => j.id === chosen) ?? judges[0];

  $('#judge-draw-title').textContent = 'القرعة تُجرى…';
  $('#judge-draw-name').textContent = '';
  $('#judge-draw-brief').textContent = '';
  $('#judge-draw-warn').textContent = '';
  overlay.hidden = false;
  overlay.classList.add('is-open');

  if (reduced) {                      // بلا دوران لمن يفضّل تقليل الحركة
    winner.classList.add('lit', 'won');
    announce(winnerJudge);
    await sleep(2200);
    return close(overlay);
  }

  // البطاقات تهبط واحدة بعد أخرى
  await sleep(180);
  for (let i = 0; i < cards.length; i++) {
    cards[i].classList.add('dealt');
    drop();
    await sleep(190);
  }
  await sleep(420);

  // النور يدور ويتباطأ حتى يقف على الفائز
  const order = cards.length;
  const spins = 3 * order + cards.indexOf(winner) + 1;
  let delay = 95;
  for (let step = 0; step < spins; step++) {
    cards.forEach((c) => c.classList.remove('lit'));
    cards[step % order].classList.add('lit');
    tick();
    await sleep(delay);
    // تباطؤ في الثلث الأخير فقط، فيُحسّ التوقف
    if (step > spins - order * 2) delay *= 1.42;
  }

  winner.classList.add('won');
  cards.forEach((c) => { if (c !== winner) c.classList.add('dimmed'); });
  gavel();
  announce(winnerJudge);

  await sleep(2600);
  return close(overlay);
}

function announce(j) {
  $('#judge-draw-title').textContent = 'قاضي هذه الجلسة';
  $('#judge-draw-name').textContent = `${j.name} — ${j.epithet}`;
  $('#judge-draw-brief').textContent = j.brief;
  $('#judge-draw-warn').textContent = j.warn ?? '';
}

async function close(overlay) {
  overlay.classList.remove('is-open');
  await sleep(420);
  overlay.hidden = true;
}
