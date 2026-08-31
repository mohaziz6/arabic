/**
 * ظلال القضاة الثلاثة — رجال عرب بلا ملامح وجه.
 * ظلّ خالص: غترة تنسدل على الكتفين، وعقال، وثوب — والوجه فراغ.
 * الإطار يقطع عند الركبة عمداً، فيبدو الرجل واقفاً لا معلّقاً.
 */

/** الميزان: منتصب متزن، غترته تنسدل متساوية — لا ميل ولا زخرف. */
const MIZAN = `
  <path class="robe" d="M42 104 C 32 132 25 168 23 200 L 117 200
                        C 115 168 108 132 98 104 C 90 98 80 95 70 95 C 60 95 50 98 42 104 Z"/>
  <path class="fold" d="M62 118 L 66 200 L 76 200 L 78 118 Z"/>
  <path class="ghutra" d="M70 14 C 51 14 41 29 41 50 C 41 70 44 86 49 96
                          L 37 128 L 103 128 L 91 96 C 96 86 99 70 99 50 C 99 29 89 14 70 14 Z"/>
  <rect class="iqal" x="43" y="26" width="54" height="8" rx="4"/>
  <rect class="iqal" x="44" y="39" width="52" height="7" rx="3"/>
`;

/** الريح: مائل، وطرف غترته منفلت في الهواء — الفوضى قبل أن ينطق. */
const REEH = `
  <g transform="rotate(-8 70 150)">
    <path class="robe" d="M40 104 C 28 134 21 170 19 200 L 113 200
                          C 112 168 105 132 96 104 C 88 98 79 95 69 95 C 58 95 48 98 40 104 Z"/>
    <path class="fold" d="M56 120 L 64 200 L 74 200 L 74 118 Z"/>
  </g>
  <g transform="rotate(11 70 60)">
    <path class="ghutra" d="M70 12 C 50 12 40 28 40 50 C 40 70 43 86 48 96
                            L 35 128 L 101 128 L 89 96 C 94 86 97 70 97 50 C 97 28 90 12 70 12 Z"/>
    <path class="ghutra" d="M95 34 C 114 22 126 26 136 12 C 130 36 114 50 96 52 Z"/>
    <rect class="iqal" x="42" y="25" width="54" height="8" rx="4"/>
    <rect class="iqal" x="44" y="38" width="50" height="7" rx="3"/>
  </g>
`;

/** العُرف: عريض بالبشت، ثابت لا يميل — شيخ قبيلة يملأ المجلس. */
const URF = `
  <path class="bisht" d="M26 108 C 14 138 7 172 5 200 L 135 200
                         C 133 172 126 138 114 108 C 102 98 88 92 70 92 C 52 92 38 98 26 108 Z"/>
  <path class="robe" d="M48 100 C 44 134 43 170 44 200 L 96 200
                        C 97 170 96 134 92 100 C 86 96 78 94 70 94 C 62 94 54 96 48 100 Z"/>
  <path class="bisht-edge" d="M26 108 L 40 200 L 47 200 C 45 166 44 132 46 102 Z"/>
  <path class="bisht-edge" d="M114 108 L 100 200 L 93 200 C 95 166 96 132 94 102 Z"/>
  <path class="ghutra" d="M70 12 C 49 12 38 28 38 51 C 38 72 41 88 47 98
                          L 33 132 L 107 132 L 93 98 C 99 88 102 72 102 51 C 102 28 91 12 70 12 Z"/>
  <rect class="iqal" x="40" y="25" width="60" height="9" rx="4"/>
  <rect class="iqal" x="41" y="39" width="58" height="8" rx="4"/>
`;

const SHAPES = { mizan: MIZAN, reeh: REEH, urf: URF };

/** يبني ظلّ قاضٍ بمعرّفه. */
export function judgeSilhouette(id) {
  return `<svg class="judge-fig" viewBox="0 0 140 200" aria-hidden="true">${
    SHAPES[id] ?? MIZAN}</svg>`;
}

export const hasSilhouette = (id) => id in SHAPES;
