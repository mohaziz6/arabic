/**
 * قاضي المحاكمة — الوكيل الصغير.
 *
 * ليس حلقة أدوات: ثلاث دوال، كل واحدة نداء واحد بمخرج منظّم يضمن JSON
 * مطابقاً للمخطط. نحن نتحكم في الترتيب، والنموذج يجيب ويسكت.
 *
 * بلا مفتاح ANTHROPIC_API_KEY يعمل قاضٍ وهمي حتى تُجرَّب اللعبة كاملة.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { CARD_BY_ID, PHASE_LABELS } from './rules.js';
import { JUDGE_BY_ID, DEFAULT_JUDGE } from './judges.js';

const MODEL = 'claude-opus-5';

export const hasCredentials = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const client = hasCredentials() ? new Anthropic() : null;

/* ─────────── شخصية القاضي ─────────── */

/**
 * كتلة النظام لقاضٍ بعينه. نص الشخصية ثابت البايتات فيُقرأ من التخزين المؤقت
 * في كل نداء بعد الأول — والجلسة الواحدة لا تبدّل قاضيها، فالكاش يصمد.
 */
const systemBlocks = (judgeId) => [
  {
    type: 'text',
    text: (JUDGE_BY_ID[judgeId] ?? JUDGE_BY_ID[DEFAULT_JUDGE]).persona,
    cache_control: { type: 'ephemeral' },
  },
];

/* ─────────── المخططات ─────────── */

const CaseSchema = z.object({
  charge: z.string().describe('التهمة، جملة واحدة عبثية مضحكة'),
  defendant: z.string().describe('اسم الشاعر المتهم ووصفه القصير'),
  facts: z.string().describe('وقائع القضية في جملتين إلى ثلاث'),
  mathal: z.string().describe('مثل عربي دارج يصلح إدخاله في مرافعة'),
  bayt: z.string().describe('بيت شعر عربي مشهور، شطران مفصولان بـ ...'),
});

const SpeechSchema = z.object({
  score: z.number().int().min(0).max(10).describe('درجة المرافعة حسب السلّم'),
  cardFulfilled: z.boolean().describe('هل نُفّذت البطاقة؟ true إن لم تُلعب بطاقة'),
  comment: z.string().describe('تعليق القاضي، جملة أو جملتان بصوته'),
});

const VerdictSchema = z.object({
  winner: z.enum(['prosecutor', 'defender']).describe('من كسب المحاكمة'),
  guilty: z.boolean().describe('هل أُدين المتهم؟'),
  spoken: z.string().describe('نطق الحكم، جملتان يُقرآن بصوت عالٍ'),
  reasoning: z.string().describe('الحيثيات، ثلاث إلى خمس جمل تُعرض نصاً'),
});

/* ─────────── نداء موحّد ─────────── */

async function ask(schema, userText, { effort = 'high', judgeId = DEFAULT_JUDGE } = {}) {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: systemBlocks(judgeId),
    thinking: { type: 'adaptive' },
    output_config: { effort, format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content: userText }],
  });

  if (res.stop_reason === 'refusal') {
    throw new Error('القاضي امتنع عن الحكم في هذه المرافعة');
  }
  if (!res.parsed_output) {
    throw new Error('تعذّر تحليل رد القاضي');
  }
  return { data: res.parsed_output, usage: res.usage };
}

/* ─────────── الدوال الثلاث ─────────── */

/** يولّد قضية عبثية جديدة، ومعها محتوى بطاقتَي المثل والبيت. */
export async function generateCase(previousCharges = [], judgeId = DEFAULT_JUDGE) {
  if (!client) return { data: mockCase(previousCharges), usage: null, mock: true };

  const avoid = previousCharges.length
    ? `\n\nلا تكرر هذه التهم السابقة:\n- ${previousCharges.join('\n- ')}`
    : '';

  return ask(
    CaseSchema,
    `ولّد قضية جديدة لمحاكمة أدبية: شاعر متهم بجرم أدبي عبثي مضحك
(مثل: سرقة بحر الطويل، أو قتل قافية عمداً مع سبق الإصرار).

ومعها مثل عربي دارج وبيت شعر مشهور، يصلحان لأن يُدخَلا في مرافعة عن هذه القضية.${avoid}`,
    { effort: 'medium', judgeId },
  );
}

/**
 * يقيّم مرافعة واحدة. يُنادى بـ effort منخفض لأن التقييم أخف من الحكم النهائي،
 * وهذا وحده يقص نحو ٤٠٪ من تكلفة المحاكمة.
 */
export async function judgeSpeech({ kase, role, phase, transcript, card, judgeId = DEFAULT_JUDGE }) {
  if (!client) return { data: mockSpeech(transcript, card, judgeId), usage: null, mock: true };

  const roleLabel = role === 'prosecutor' ? 'المدعي العام' : 'محامي الدفاع';
  const cardText = card
    ? `\n\nلعب هذا المتحدّث بطاقة «${CARD_BY_ID[card.cardId].name}»: ${
        CARD_BY_ID[card.cardId].brief}${card.content ? `\nالمطلوب إدخاله: ${card.content}` : ''}
احكم في cardFulfilled هل نفّذها فعلاً.`
    : '\n\nلم يلعب بطاقة — اجعل cardFulfilled = true.';

  return ask(
    SpeechSchema,
    `القضية: ${kase.charge}
المتهم: ${kase.defendant}
الوقائع: ${kase.facts}

المرحلة: ${PHASE_LABELS[phase]}
المتحدّث: ${roleLabel}${cardText}

نص المرافعة:
"""
${transcript || '(صمت)'}
"""

قيّمها.`,
    { effort: 'low', judgeId },
  );
}

/** يفصل في اعتراض: هل كان وجيهاً؟ */
export async function judgeObjection({ kase, transcript, judgeId = DEFAULT_JUDGE }) {
  if (!client) {
    return { data: { sustained: (transcript || '').length > 40 }, usage: null, mock: true };
  }
  return ask(
    z.object({
      sustained: z.boolean().describe('هل الاعتراض وجيه؟'),
      comment: z.string().describe('كلمة القاضي: مقبول أو مرفوض ولماذا'),
    }),
    `القضية: ${kase.charge}

اعترض الخصم أثناء هذه المرافعة:
"""
${transcript || '(لم يقل شيئاً بعد)'}
"""

هل الاعتراض وجيه؟ اقبله إن كانت المرافعة خرجت عن القضية أو ادّعت بلا دليل،
وارفضه إن كان الاعتراض تشويشاً على حجة سليمة.`,
    { effort: 'low', judgeId },
  );
}

/** الحكم النهائي — أعلى مستوى تفكير، فهو أثقل قرار في المحاكمة. */
export async function deliverVerdict({ kase, speeches, scores, names, judgeId = DEFAULT_JUDGE }) {
  if (!client) return { data: mockVerdict(speeches, scores, names, judgeId), usage: null, mock: true };

  const record = speeches
    .map((sp) => {
      const who = sp.role === 'prosecutor' ? 'المدعي العام' : 'محامي الدفاع';
      return `[${PHASE_LABELS[sp.phase]} — ${who}، درجة ${sp.judgement.score}/١٠]\n${sp.transcript}`;
    })
    .join('\n\n');

  return ask(
    VerdictSchema,
    `القضية: ${kase.charge}
المتهم: ${kase.defendant}
الوقائع: ${kase.facts}

محضر الجلسة:
${record}

مجموع الدرجات — المدعي العام: ${scores.prosecutor}، محامي الدفاع: ${scores.defender}

انطق الحكم. الدرجات مرشد لا مُلزِم: من أقنعك بالحجة يكسب ولو تأخّر رصيده.`,
    { effort: 'high', judgeId },
  );
}

/* ─────────── القاضي الوهمي (بلا مفتاح) ─────────── */

const MOCK_CASES = [
  {
    charge: 'سرقة بحر الطويل والفرار به إلى قصيدة أخرى',
    defendant: 'أبو الغصون، شاعر مغمور يدّعي النسب إلى المتنبي',
    facts: 'ضُبط البحر ناقصاً تفعيلتين، وشُوهد المتهم يبيعهما في سوق عكاظ.',
    mathal: 'الجار قبل الدار',
    bayt: 'ومن يكُ ذا فمٍ مُرٍّ مريضٍ ... يجد مُرّاً به الماءَ الزُّلالا',
  },
  {
    charge: 'قتل قافية عمداً مع سبق الإصرار والترصّد',
    defendant: 'حمدان الطويل، شاعر مناسبات',
    facts: 'وُجدت القافية مخنوقة في آخر البيت، وبصماته على الرويّ.',
    mathal: 'رمتني بدائها وانسلّت',
    bayt: 'وإذا المنيّة أنشبت أظفارها ... ألفيتَ كلَّ تميمةٍ لا تنفعُ',
  },
  {
    charge: 'انتحال شخصية شاعر جاهلي بقصد الاحتيال العاطفي',
    defendant: 'سالم بن سالم، يزعم أنه ابن عم امرئ القيس',
    facts: 'أنشد معلّقةً في مجلس، وتبيّن أنها مترجمة عن أغنية حديثة.',
    mathal: 'إن كنت ريحاً فقد لاقيتَ إعصاراً',
    bayt: 'أنا الذي نظر الأعمى إلى أدبي ... وأسمعت كلماتي من به صمَمُ',
  },
];

function mockCase(previous) {
  const fresh = MOCK_CASES.filter((c) => !previous.includes(c.charge));
  return (fresh.length ? fresh : MOCK_CASES)[Math.floor(Math.random() * (fresh.length || MOCK_CASES.length))];
}

function mockSpeech(transcript, card, judgeId = DEFAULT_JUDGE) {
  const words = (transcript || '').trim().split(/\s+/).filter(Boolean).length;

  // القاضي الوهمي يحاكي ميل كل شخصية ولو تقريباً، فيُحسّ الفرق أثناء التجربة
  let score;
  if (judgeId === 'reeh') score = words < 4 ? 1 : 3 + Math.floor(Math.random() * 7);
  else if (judgeId === 'urf') score = words < 4 ? 1 : Math.max(3, 10 - Math.floor(words / 6));
  else score = Math.max(0, Math.min(10, Math.round(words / 8)));
  const fulfilled = !card || (card.content
    ? (transcript || '').includes(card.content.split(' ')[0])
    : words > 10);
  const name = (JUDGE_BY_ID[judgeId] ?? JUDGE_BY_ID[DEFAULT_JUDGE]).name;
  const quips = {
    mizan: score >= 7 ? 'حجة متماسكة، ولو زانها بيت لعلَت.' : 'حجتك مفهومة، وعبارتك باردة.',
    reeh: score >= 7 ? 'أعجبتني كلمة فيها… لا أذكر أيها. لك التسعة!' : 'مللتُ في منتصفها. غيّرتُ رأيي مرتين.',
    urf: score >= 7 ? 'قلتَها مختصرة واضحة. هذا كلام رجال.' : 'طوّلتَ ولففت. اقطع على قدّ ما يكفي.',
  };
  return {
    score,
    cardFulfilled: fulfilled,
    comment: `[${name} — قاضٍ وهمي بلا مفتاح] سمعتُ ${words} كلمة. ${quips[judgeId] ?? quips.mizan}`,
  };
}

function mockVerdict(speeches, scores, names, judgeId = DEFAULT_JUDGE) {
  const guilty = scores.prosecutor >= scores.defender;
  return {
    winner: guilty ? 'prosecutor' : 'defender',
    guilty,
    spoken: guilty
      ? 'حكمت المحكمة بإدانة المتهم. رُفعت الجلسة.'
      : 'حكمت المحكمة ببراءة المتهم. رُفعت الجلسة.',
    reasoning: `[${(JUDGE_BY_ID[judgeId] ?? JUDGE_BY_ID[DEFAULT_JUDGE]).name} — قاضٍ وهمي، أضف ANTHROPIC_API_KEY لحكم حقيقي] رجحت كفّة ${
      guilty ? names.prosecutor : names.defender} بفارق الدرجات (${
      scores.prosecutor} مقابل ${scores.defender}).`,
  };
}
