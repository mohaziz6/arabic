/**
 * رسوم الأسلحة — رموز من ثقافتنا لا أيقونات عامة.
 * قيد الفصحى: قلم ودواة. المثل: نخلة. البيت: عود ووتر. الاعتراض: مطرقة القضاء.
 */

/** قلم قصب ودواة — قيد الفصحى: اللغة تُكتب لا تُرتجل. */
const FUSHA = `
  <path class="ink" d="M78 14 L 92 28 L 46 74 L 28 80 L 34 62 Z"/>
  <path class="ink-dark" d="M34 62 L 46 74 L 28 80 Z"/>
  <path class="ink-dark" d="M74 18 L 88 32 L 82 38 L 68 24 Z"/>
  <path class="ink" d="M24 92 C 24 84 36 80 50 80 C 64 80 76 84 76 92 L 72 108
                       C 70 114 62 118 50 118 C 38 118 30 114 28 108 Z"/>
  <ellipse class="ink-dark" cx="50" cy="92" rx="26" ry="7"/>
`;

/** نخلة — المثل من الأرض ومن الجذر. */
const MATHAL = `
  <path class="ink" d="M54 60 C 52 82 50 100 48 118 L 62 118 C 60 100 58 82 56 60 Z"/>
  <path class="ink-dark" d="M52 74 L 58 74 M51 88 L 59 88 M50 102 L 60 102" stroke="currentColor" stroke-width="2" fill="none"/>
  <path class="ink" d="M55 54 C 40 46 24 46 12 54 C 26 44 42 42 55 48 Z"/>
  <path class="ink" d="M55 54 C 70 46 86 46 98 54 C 84 44 68 42 55 48 Z"/>
  <path class="ink" d="M55 50 C 44 34 30 26 16 26 C 32 30 46 40 55 52 Z"/>
  <path class="ink" d="M55 50 C 66 34 80 26 94 26 C 78 30 64 40 55 52 Z"/>
  <path class="ink" d="M55 48 C 50 30 50 18 55 8 C 60 18 60 30 55 48 Z"/>
  <circle class="ink-dark" cx="46" cy="56" r="4"/>
  <circle class="ink-dark" cx="64" cy="57" r="4"/>
  <circle class="ink-dark" cx="55" cy="62" r="4"/>
`;

/** عود ووتر — البيت يُنشد لا يُقال. */
const BAYT = `
  <path class="ink" d="M46 62 C 30 62 20 76 20 92 C 20 108 32 118 48 118
                       C 64 118 76 108 76 92 C 76 76 64 62 46 62 Z"/>
  <circle class="ink-dark" cx="48" cy="90" r="11"/>
  <path class="ink" d="M62 66 L 92 20 L 100 26 L 70 72 Z"/>
  <path class="ink-dark" d="M88 16 L 104 28 L 98 36 L 82 24 Z"/>
  <path class="strings" d="M56 70 L 88 26 M62 74 L 94 30 M67 79 L 99 34"
        stroke="currentColor" stroke-width="1.6" fill="none" opacity=".55"/>
`;

/** مطرقة القضاء على قاعدتها — الاعتراض يقطع الكلام. */
const OBJECTION = `
  <g transform="rotate(-28 60 56)">
    <rect class="ink" x="30" y="34" width="60" height="30" rx="8"/>
    <path class="ink-dark" d="M30 42 h60 v6 h-60 z"/>
    <rect class="ink" x="55" y="62" width="11" height="42" rx="5"/>
  </g>
  <rect class="ink" x="24" y="104" width="72" height="12" rx="5"/>
  <path class="ink-dark" d="M24 104 h72 v4 h-72 z"/>
`;

const ART = { fusha: FUSHA, mathal: MATHAL, bayt: BAYT, objection: OBJECTION };

/** يبني رسم سلاح بمعرّفه. */
export function cardArt(id) {
  return `<svg class="card-art" viewBox="0 0 120 128" aria-hidden="true">${
    ART[id] ?? FUSHA}</svg>`;
}
