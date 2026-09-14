/**
 * شعار «مَن أنا» — قوسٌ طينيٌّ نجديّ تتطاير حوله مخطوطات.
 *
 * SVG مولَّد لا ملفّ صورة، فيأخذ ألوانه من متغيّرات الصفحة ويكبر بلا تحبّب.
 * الحركة كلها في CSS (`.ma-emblem`): القوس يهبط ويرتفع في نَفَسٍ بطيء،
 * والمخطوطات تطفو حوله بسرعاتٍ مختلفة فلا يبدو المشهد جامداً.
 */

/** ورقةُ مخطوطٍ بأسطر حبرٍ باهتة. */
function sheet(x, y, w, h, rot, cls) {
  const lines = Array.from({ length: 4 }, (_, i) =>
    `<rect x="${x + 5}" y="${y + 7 + i * 5.5}" width="${(w - 10) * (i === 3 ? 0.55 : 0.9)}" height="1.6" rx="0.8"/>`,
  ).join('');
  return `<g class="ma-sheet ${cls}" transform="rotate(${rot} ${x + w / 2} ${y + h / 2})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
            fill="var(--white)" stroke="var(--line-strong)" stroke-width="1"/>
      <g fill="var(--line-strong)" opacity="0.75">${lines}</g>
    </g>`;
}

/** شريط المثلثات النجدي — الزخرفة نفسها المستعملة فاصلاً في بقية الديوان. */
function band(x0, y, count, width) {
  const step = width / count;
  const tri = Array.from({ length: count }, (_, i) => {
    const x = x0 + i * step;
    return `M ${x} ${y} L ${x + step / 2} ${y + 5} L ${x + step} ${y} Z`;
  }).join(' ');
  return `<path d="${tri}" fill="var(--gold)" opacity="0.55"/>`;
}

/**
 * القوس والمخطوطات. النصّ نفسه («مَن أنا؟») يُكتب في HTML فوقه لا هنا،
 * ليأخذ خطّ العناوين وأحجامه المتجاوبة.
 */
export function emblemSvg() {
  return `<svg viewBox="0 0 240 210" role="img" aria-label="شعار مَن أنا" focusable="false">
    ${sheet(6, 34, 46, 34, -14, 'ms-a')}
    ${sheet(188, 22, 44, 32, 11, 'ms-b')}
    ${sheet(14, 140, 42, 30, 8, 'ms-c')}
    ${sheet(186, 148, 44, 32, -9, 'ms-d')}

    <g class="ma-arch">
      <!-- قوسٌ طينيّ: نصف دائرة فوق قاعدة مستقيمة -->
      <path d="M 72 190 L 72 96 A 48 48 0 0 1 168 96 L 168 190 Z"
            fill="var(--gold-tint)" stroke="var(--gold)" stroke-width="2.5"/>
      <path d="M 82 190 L 82 100 A 38 38 0 0 1 158 100 L 158 190 Z"
            fill="none" stroke="var(--gold-soft)" stroke-width="1.5"/>
      ${band(78, 172, 7, 84)}
      <rect x="64" y="186" width="112" height="7" rx="2.5"
            fill="var(--gold)" opacity="0.9"/>
    </g>
  </svg>`;
}
