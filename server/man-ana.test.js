/**
 * اختبار آلة حالات «مَن أنا» — دوال خالصة، بلا شبكة ولا مؤقّت حقيقي.
 * التلميح يتقدّم باستدعاء `advanceClue` مباشرةً، فلا ينتظر الاختبار ثانيةً واحدة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as M from './man-ana.js';
import { FIGURE_BY_ID, POINTS_BY_CLUE } from './man-ana-figures.js';

/** جلسةٌ بلاعبَين وشخصياتٍ معلومة — فالسباق يُختبر بلا عشوائية. */
function session(deck = ['mutanabbi', 'khansa', 'jahiz']) {
  const s = M.createSession('WHOA', 'a', 'أحمد');
  M.addPlayer(s, 'b', 'بدر');
  M.startSession(s, () => deck);
  return s;
}

const nameOf = (id) => FIGURE_BY_ID[id].name;

test('تطبيع الجواب: بلا تشكيل ولا همزٍ ولا أداة تعريف', () => {
  const fig = FIGURE_BY_ID.mutanabbi;
  for (const g of ['المتنبي', 'متنبي', 'المُتَنَبِّي', 'ٱلمتنبى', ' المتنبي ', 'أبو الطيب']) {
    assert.ok(M.matches(fig, g), `رُفض خطأً: ${g}`);
  }
  for (const g of ['الجاحظ', '', '   ', 'متنب']) {
    assert.equal(M.matches(fig, g), false, `قُبل خطأً: ${g}`);
  }
});

test('الجلسة ثلاث شخصيات، وتبدأ بالتلميح الأول وأعلى قيمة', () => {
  const s = session();
  assert.equal(s.deck.length, M.FIGURES_PER_SESSION);
  assert.equal(s.clueIndex, 0);
  assert.equal(s.phase, 'clues');
  assert.equal(M.currentPoints(s), POINTS_BY_CLUE[0]);
  assert.equal(POINTS_BY_CLUE.length, M.CLUES_PER_FIGURE);
});

test('القيمة تتناقص مع كل تلميح، ومن جازف مبكراً كسب أكثر', () => {
  const early = session();
  M.guess(early, 'a', nameOf('mutanabbi'));
  assert.equal(early.scores.a, 6, 'الإصابة عند التلميح الأول تساوي ستاً');

  const late = session();
  for (let i = 0; i < 5; i++) M.advanceClue(late);
  assert.equal(M.currentPoints(late), 1);
  M.guess(late, 'a', nameOf('mutanabbi'));
  assert.equal(late.scores.a, 1, 'وعند الأخير نقطةً واحدة');
});

test('المخطئ يُقفل حتى التلميح التالي لا حتى آخر الشخصية', () => {
  const s = session();

  const miss = M.guess(s, 'a', 'ابن بطوطة');
  assert.equal(miss.correct, false);
  assert.equal(M.isLocked(s, 'a'), true);
  assert.equal(M.isLocked(s, 'b'), false, 'خصمه حرّ');
  assert.equal(M.guess(s, 'a', nameOf('mutanabbi')).ok, false, 'لا تخمين ثانٍ في التلميح نفسه');
  assert.equal(s.phase, 'clues', 'الشخصية لم تُطوَ');

  M.advanceClue(s);
  assert.equal(M.isLocked(s, 'a'), false, 'فُكّ القفل مع التلميح الجديد');
  assert.equal(M.guess(s, 'a', nameOf('mutanabbi')).correct, true);
  assert.equal(s.scores.a, 5, 'وأخذ قيمة التلميح الثاني');
});

test('الخطأ يُعرض بنصّه للطرفين', () => {
  const s = session();
  M.guess(s, 'b', 'ابن سينا');

  const mine = M.viewFor(s, 'b').misses;
  const theirs = M.viewFor(s, 'a').misses;
  assert.equal(mine[0].text, 'ابن سينا');
  assert.equal(mine[0].mine, true);
  assert.equal(theirs[0].text, 'ابن سينا', 'الخصم يرى نصّ التخمين');
  assert.equal(theirs[0].mine, false);
});

test('نفاد التلميحات يطوي الشخصية بلا نقاط لأحد', () => {
  const s = session();
  for (let i = 0; i < M.CLUES_PER_FIGURE - 1; i++) {
    assert.equal(M.advanceClue(s).ok, true);
    assert.equal(s.phase, 'clues');
  }
  const last = M.advanceClue(s);

  assert.equal(last.exhausted, true);
  assert.equal(s.phase, 'reveal');
  assert.equal(s.solvedBy, null);
  assert.equal(s.scores.a, 0);
  assert.equal(s.scores.b, 0);
  assert.equal(M.advanceClue(s).ok, false, 'لا تلميح بعد الكشف');
});

test('التلميحات التي لم يحن وقتها لا تغادر الخادم، ولا الجواب', () => {
  const s = session();

  const first = M.viewFor(s, 'a');
  assert.equal(first.clues.length, 1, 'تلميح واحد فقط');
  assert.equal(first.answer, null, 'الجواب محجوب');
  const flat = JSON.stringify(first);
  assert.equal(flat.includes('الخيل'), false, 'تلميح لاحق مُسرَّب');
  assert.equal(flat.includes(nameOf('mutanabbi')), false, 'اسم الشخصية مُسرَّب');

  M.advanceClue(s);
  assert.equal(M.viewFor(s, 'a').clues.length, 2);

  M.guess(s, 'a', nameOf('mutanabbi'));
  const after = M.viewFor(s, 'a');
  assert.equal(after.answer.name, nameOf('mutanabbi'), 'يُكشف بعد الحلّ');
  assert.ok(after.answer.reveal.length > 20);
});

test('الحلّ يُنهي الشخصية فلا يُقبل تخمينٌ بعده', () => {
  const s = session();
  M.guess(s, 'a', nameOf('mutanabbi'));
  assert.equal(s.phase, 'reveal');
  assert.equal(M.guess(s, 'b', nameOf('mutanabbi')).ok, false);
  assert.equal(s.scores.b, 0);
});

test('التالي ينتقل بشخصيةٍ نظيفة ثم ينهي الجلسة بفائز', () => {
  const s = session();
  assert.equal(M.next(s).ok, false, 'لا انتقال قبل الكشف');

  M.guess(s, 'a', 'ابن سينا');           // خطأ يُبقي أثراً
  M.guess(s, 'a', nameOf('mutanabbi'));  // مقفول، فلا شيء
  M.advanceClue(s);
  M.guess(s, 'a', nameOf('mutanabbi'));

  assert.equal(M.next(s).ok, true);
  assert.equal(s.figureIndex, 1);
  assert.equal(s.clueIndex, 0, 'الشخصية الجديدة تبدأ من أولها');
  assert.deepEqual(s.misses, [], 'أخطاء السابقة تُمسح');
  assert.deepEqual(s.lockedAt, {}, 'والأقفال تُفكّ');

  M.guess(s, 'b', nameOf('khansa'));
  M.next(s);
  M.guess(s, 'b', nameOf('jahiz'));
  const done = M.next(s);

  assert.equal(done.done, true);
  assert.equal(s.status, 'over');
  assert.equal(s.winnerId, 'b', 'بدر أخذ اثنتين بستٍّ لكلٍّ');
  assert.equal(s.scores.b, 12);
  assert.equal(s.scores.a, 5);
});

test('تعادل الرصيدين ينتهي بلا فائز', () => {
  const s = session(['mutanabbi', 'khansa', 'jahiz']);
  M.guess(s, 'a', nameOf('mutanabbi'));
  M.next(s);
  M.guess(s, 'b', nameOf('khansa'));
  M.next(s);
  for (let i = 0; i < M.CLUES_PER_FIGURE; i++) M.advanceClue(s);   // الثالثة بلا حلّ
  M.next(s);

  assert.equal(s.status, 'over');
  assert.equal(s.scores.a, s.scores.b);
  assert.equal(s.winnerId, null);
});

test('الاسم يُقبل داخل جملةٍ أطول، ولا تكفي كلمةٌ منه', () => {
  const full = FIGURE_BY_ID.mutanabbi;
  for (const g of ['الشاعر المتنبي', 'ابو الطيب احمد بن الحسين المتنبي', 'المتنبي أبو الطيب']) {
    assert.ok(M.matches(full, g), `رُفض جوابٌ صحيح: ${g}`);
  }
  // جزءُ الاسم ليس الاسم: «سينا» وحدها ليست «ابن سينا»
  assert.equal(M.matches(FIGURE_BY_ID['ibn-sina'], 'سينا'), false);
  assert.equal(M.matches(FIGURE_BY_ID['ibn-khaldun'], 'خلدون'), false);
  assert.equal(M.matches(full, 'الطيب'), false);
});
