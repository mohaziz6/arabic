/**
 * قواعد لعبة المحاكمة — ثوابت مشتركة بين الخادم والواجهة.
 * المواصفة الكاملة في docs/trial-agent.md
 */

export const ROLES = { PROSECUTOR: 'prosecutor', DEFENDER: 'defender' };

/** مراحل المحاكمة الواحدة بالترتيب. */
export const PHASES = [
  { id: 'case',            seconds: 0,  speaker: null },
  { id: 'opening-pros',    seconds: 90, speaker: ROLES.PROSECUTOR },
  { id: 'opening-def',     seconds: 90, speaker: ROLES.DEFENDER },
  { id: 'rebuttal-pros',   seconds: 45, speaker: ROLES.PROSECUTOR },
  { id: 'rebuttal-def',    seconds: 45, speaker: ROLES.DEFENDER },
  { id: 'verdict',         seconds: 0,  speaker: null },
];

export const PHASE_LABELS = {
  'case': 'عرض القضية',
  'opening-pros': 'مرافعة الادعاء',
  'opening-def': 'مرافعة الدفاع',
  'rebuttal-pros': 'ردّ الادعاء',
  'rebuttal-def': 'ردّ الدفاع',
  'verdict': 'الحكم',
};

/**
 * البطاقات الأربع — كلها **أسلحة تُرمى على الخصم أثناء مرافعته**، لا قيوداً
 * على نفسك. ترمي القيد فيراه خصمك ويصارعه أمام القاضي.
 *
 * المقامرة: إن كسر القيد ربح النقاط، وإن عجز خسرها. فأنت ترمي حين تظنه يعجز.
 * تدوم البطاقات الجلسة كلها، وتُرمى واحدة كحد أقصى في كل مرافعة.
 */
export const CARDS = [
  {
    id: 'fusha',
    name: 'قيد الفصحى',
    brief: 'تُلزم خصمك بالفصحى وحدها',
    onTarget: 'مرافعتك كلها بالفصحى بلا لهجة',
    glyph: 'ف',
    generated: false,        // لا محتوى يولّده الوكيل — قاعدة فقط
    bonus: 3,
    penalty: -3,
  },
  {
    id: 'mathal',
    name: 'رمية المثل',
    brief: 'تُلزم خصمك بإدخال مثلٍ بعينه',
    onTarget: 'أدخل هذا المثل في مرافعتك بسياق سليم',
    glyph: 'م',
    generated: true,
    bonus: 3,
    penalty: -3,
  },
  {
    id: 'bayt',
    name: 'رمية البيت',
    brief: 'تُلزم خصمك بإدخال بيت شعر بعينه',
    onTarget: 'أدخل هذا البيت في مرافعتك',
    glyph: 'ب',
    generated: true,
    bonus: 4,
    penalty: -3,
  },
  {
    id: 'objection',
    name: 'اعتراض',
    brief: 'تقاطع خصمك، والقاضي يقبل أو يرفض',
    onTarget: null,
    glyph: 'ع',
    generated: false,
    interrupt: true,         // توقف مؤقّته حتى يفصل القاضي، والنقاط عليك أنت
    bonus: 3,
    penalty: -3,
  },
];

export const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

/** عدد الأحكام التي تكسبها لتفوز بالجلسة. */
export const WINS_NEEDED = 2;

/** أقصى عدد محاكمات في الجلسة — أول من يكسب حكمين يفوز، فثلاث تكفي. */
export const MAX_TRIALS = 3;
