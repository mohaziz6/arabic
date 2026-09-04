/**
 * اختبار آلة حالات «مَعاني» — دوال خالصة، بلا شبكة ولا خادم.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as M from './maani.js';
import { RELATIONS } from './maani-words.js';

/** جلسةٌ بلاعبَين وأسئلةٍ معلومة — فالسباق يُختبر بلا عشوائية. */
function session(deck) {
  const s = M.createSession('WORD', 'a', 'أحمد');
  M.addPlayer(s, 'b', 'بدر');
  M.startSession(s, () => deck);
  return s;
}

const pairQ = { level: 'pair', points: 1, a: 'كَرَم', b: 'بُخل', answer: 'antonym', why: 'ضدّان' };
const huntQ = { level: 'hunt', points: 2, word: 'سَخاء', mode: 'synonym',
                grid: ['جُود', 'بُخل', 'مِفتاح'], answer: 'جُود', why: 'مرادف' };
const intruderQ = { level: 'intruder', points: 3, theme: 'الكرم',
                    words: ['جُود', 'سَخاء', 'كَرَم', 'بَذْل', 'عَطاء', 'شُحّ'],
                    answer: 'شُحّ', why: 'ضدّها' };

test('الأسئلة اثنا عشر: أربعة لكل مستوى بترتيب تصاعدي', () => {
  const deck = M.buildDeck();
  assert.equal(deck.length, M.LEVELS.length * M.QUESTIONS_PER_LEVEL);
  assert.deepEqual(
    deck.map((q) => q.level),
    [...Array(4).fill('pair'), ...Array(4).fill('hunt'), ...Array(4).fill('intruder')],
  );
  // النقاط تتصاعد مع المستوى
  assert.deepEqual([...new Set(deck.map((q) => q.points))], [1, 2, 3]);
});

test('شبكة الحصاد خمس عشرة كلمة بلا تكرار، وفيها الجواب وفخُّه', () => {
  for (let i = 0; i < 20; i++) {
    for (const q of M.buildDeck().filter((x) => x.level === 'hunt')) {
      assert.equal(q.grid.length, M.GRID_SIZE);
      assert.equal(new Set(q.grid).size, M.GRID_SIZE, 'كلمة مكرّرة في الشبكة');
      assert.ok(q.grid.includes(q.answer), 'الجواب ليس في الشبكة');
      assert.ok(!q.grid.includes(q.word), 'الكلمة المطلوبة نفسها في الشبكة');
    }
  }
});

test('سؤال الدخيل ستّ كلمات والدخيلة بينها', () => {
  for (const q of M.buildDeck().filter((x) => x.level === 'intruder')) {
    assert.equal(q.words.length, M.FAMILY_SIZE + 1);
    assert.ok(q.words.includes(q.answer));
  }
});

test('الجلسة لا تبدأ بلاعب واحد ولا تبدأ مرتين', () => {
  const s = M.createSession('WORD', 'a', 'أحمد');
  assert.equal(M.startSession(s).ok, false);
  M.addPlayer(s, 'b', 'بدر');
  assert.equal(M.startSession(s).ok, true);
  assert.equal(M.startSession(s).ok, false, 'بدأت مرة ثانية');
});

test('أول من يصيب يأخذ النقاط ويُغلق السؤال على خصمه', () => {
  const s = session([pairQ]);
  const r = M.answer(s, 'b', 'antonym');

  assert.equal(r.correct, true);
  assert.equal(r.resolved, true);
  assert.equal(s.scores.b, 1);
  assert.equal(s.scores.a, 0);
  assert.equal(s.phase, 'reveal');
  assert.equal(M.answer(s, 'a', 'antonym').ok, false, 'أُغلق السؤال على الخصم');
});

test('من أخطأ خرج وحده، وخصمه يكسب بعده', () => {
  const s = session([huntQ]);

  const miss = M.answer(s, 'a', 'بُخل');          // الفخّ: ضدُّها لا مرادفها
  assert.equal(miss.correct, false);
  assert.equal(miss.resolved, false, 'السؤال يبقى مفتوحاً لخصمه');
  assert.equal(s.phase, 'ask');
  assert.equal(M.answer(s, 'a', 'جُود').ok, false, 'المخطئ لا يجيب مرتين');

  const hit = M.answer(s, 'b', 'جُود');
  assert.equal(hit.correct, true);
  assert.equal(s.scores.b, 2);
  assert.equal(s.scores.a, 0);
  assert.equal(s.phase, 'reveal');
});

test('إن أخطأ الاثنان فلا نقاط لأحد', () => {
  const s = session([intruderQ]);
  M.answer(s, 'a', 'جُود');
  M.answer(s, 'b', 'كَرَم');

  assert.equal(s.phase, 'reveal');
  assert.equal(s.roundWinnerId, null);
  assert.equal(s.scores.a, 0);
  assert.equal(s.scores.b, 0);
});

test('لا تُقبل إجابة من خارج المعروض', () => {
  const s = session([huntQ]);
  assert.equal(M.answer(s, 'a', 'سَفينة').ok, false, 'كلمة ليست في الشبكة');
  assert.equal(M.answer(s, 'a', '').ok, false);

  const p = session([pairQ]);
  assert.equal(M.answer(p, 'a', 'شِبه').ok, false, 'علاقة غير معروفة');
  assert.deepEqual(RELATIONS.map((r) => r.id).sort(), ['antonym', 'none', 'synonym']);
});

test('الجواب لا يغادر الخادم قبل الكشف، ولا اختيارُ الخصم', () => {
  const s = session([huntQ, pairQ]);

  const before = M.viewFor(s, 'a');
  assert.equal(before.solution, null, 'الجواب مُسرَّب قبل الكشف');
  assert.equal(JSON.stringify(before).includes('"why"'), false, 'التعليل يفضح الجواب');
  assert.deepEqual(before.question.grid, huntQ.grid, 'الشبكة تصل كما رُصفت في الخادم');

  M.answer(s, 'b', 'بُخل');                       // خطأ من الخصم
  const during = M.viewFor(s, 'a');
  assert.equal(during.oppAnswered, true, 'يُعلم أنه أجاب');
  assert.equal(during.oppAnswer, null, 'بماذا أجاب لا يُرى قبل الكشف');
  assert.equal(during.solution, null);

  M.answer(s, 'a', 'جُود');
  const after = M.viewFor(s, 'a');
  assert.equal(after.solution.answer, 'جُود');
  assert.equal(after.solution.winnerId, 'a');
  assert.equal(after.oppAnswer.choice, 'بُخل', 'يُكشف اختيار الخصم بعد الحكم');
});

test('التالي ينتقل بين الأسئلة ثم ينهي الجلسة بفائز', () => {
  const s = session([pairQ, huntQ]);

  assert.equal(M.next(s).ok, false, 'لا انتقال قبل الكشف');
  M.answer(s, 'a', 'antonym');
  assert.equal(M.next(s).ok, true);
  assert.equal(s.index, 1);
  assert.deepEqual(s.answers, {}, 'إجابات السؤال السابق تُمسح');

  M.answer(s, 'a', 'جُود');
  const done = M.next(s);
  assert.equal(done.done, true);
  assert.equal(s.status, 'over');
  assert.equal(s.winnerId, 'a');
  assert.equal(s.scores.a, 3);
});

test('تعادل الرصيدين ينتهي بلا فائز', () => {
  const s = session([pairQ, { ...pairQ, a: 'صِدق', b: 'كَذِب' }]);
  M.answer(s, 'a', 'antonym');
  M.next(s);
  M.answer(s, 'b', 'antonym');
  M.next(s);

  assert.equal(s.status, 'over');
  assert.equal(s.winnerId, null);
  assert.equal(s.scores.a, s.scores.b);
});
