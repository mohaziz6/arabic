/**
 * ظلال القضاة الثلاثة — رجال عرب بلا ملامح وجه.
 *
 * المرجع: رجل بثوب منساب وغترة طويلة تنسدل على الصدر، وبشت على الكتفين،
 * وسيف عند الخصر، والرأس مائل والوجه فراغ. الإطار يقطع عند الركبة.
 */

/** غترة طويلة تنسدل على الصدر — العنصر المشترك بين الثلاثة. */
const ghutra = (opts = {}) => {
  const { drape = 150 } = opts;
  return `
  <path class="ghutra" d="M70 12
    C 47 12 36 30 36 54 C 36 74 39 90 45 100
    L 30 ${drape} L 40 ${drape + 14} L 52 ${drape - 20} L 60 108 L 88 108 L 96 ${drape - 24}
    L 106 ${drape + 10} L 114 ${drape - 4} L 95 100
    C 101 90 104 74 104 54 C 104 30 93 12 70 12 Z"/>
  <path class="ghutra-fold" d="M45 100 L 36 ${drape - 6} L 52 ${drape - 24} L 58 104 Z"/>
  <rect class="iqal" x="38" y="24" width="64" height="9" rx="4"/>
  <rect class="iqal" x="39" y="39" width="62" height="8" rx="4"/>`;
};

/** سيف عند الخصر — حزام وقبضة ونصل منحنٍ. */
const sword = (x, y, tilt) => `
  <g transform="translate(${x} ${y}) rotate(${tilt})" class="sword">
    <path d="M-4 0 L 4 0 L 6 46 C 6 58 -2 66 -8 70 L -12 62 C -8 58 -3 52 -3 44 Z"/>
    <rect x="-11" y="-9" width="22" height="8" rx="3"/>
    <rect x="-4" y="-20" width="8" height="12" rx="3"/>
  </g>`;

/** الميزان: منتصب متزن، الغترة متساوية الطرفين، السيف ساكن. */
const MIZAN = `
  <path class="robe" d="M44 104 C 33 134 25 172 23 210 L 117 210
                        C 115 172 107 134 96 104 C 88 98 80 95 70 95 C 60 95 52 98 44 104 Z"/>
  <path class="fold" d="M64 120 L 66 210 L 78 210 L 78 118 Z"/>
  ${sword(104, 150, 12)}
  ${ghutra()}
`;

/** الريح: مائل، وطرف غترته منفلت في الهواء، والسيف مائل معه. */
const REEH = `
  <g transform="rotate(-9 70 160)">
    <path class="robe" d="M40 104 C 27 136 20 174 18 210 L 112 210
                          C 111 172 103 134 92 104 C 85 98 78 95 68 95 C 57 95 48 98 40 104 Z"/>
    <path class="fold" d="M58 122 L 64 210 L 76 210 L 74 118 Z"/>
    ${sword(100, 148, 26)}
  </g>
  <g transform="rotate(12 70 60)">
    ${ghutra({ drape: 138 })}
    <path class="ghutra" d="M100 40 C 122 26 134 30 146 12 C 140 42 120 58 98 60 Z"/>
  </g>
`;

/** العُرف: عريض بالبشت، ثابت، والسيف بارز — شيخ قبيلة يملأ المجلس. */
const URF = `
  <path class="bisht" d="M24 110 C 11 142 4 178 2 212 L 138 212
                         C 136 178 129 142 116 110 C 103 99 88 93 70 93 C 52 93 37 99 24 110 Z"/>
  <path class="robe" d="M46 102 C 42 138 41 176 42 212 L 98 212
                        C 99 176 98 138 94 102 C 87 97 79 95 70 95 C 61 95 53 97 46 102 Z"/>
  <path class="bisht-edge" d="M24 110 L 38 212 L 46 212 C 43 174 42 138 44 104 Z"/>
  <path class="bisht-edge" d="M116 110 L 102 212 L 94 212 C 97 174 98 138 96 104 Z"/>
  ${sword(108, 150, 8)}
  ${ghutra({ drape: 156 })}
`;

const SHAPES = { mizan: MIZAN, reeh: REEH, urf: URF };

/** يبني ظلّ قاضٍ بمعرّفه. */
export function judgeSilhouette(id) {
  return `<svg class="judge-fig" viewBox="0 0 140 212" aria-hidden="true">${
    SHAPES[id] ?? MIZAN}</svg>`;
}

export const hasSilhouette = (id) => id in SHAPES;
