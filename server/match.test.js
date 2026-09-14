import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './match.js';

const KNOWN = ['muhakama', 'sanad', 'maani', 'man-ana', 'mazad'];
const fresh = (games = ['maani', 'sanad', 'man-ana']) => M.createMatch(games, KNOWN, ['a', 'b']);

test('المباراة تُبنى مرتّبةً بلا تكرارٍ ولا مجهول', () => {
  const m = M.createMatch(['sanad', 'sanad', 'لا-وجود-لها', 'maani'], KNOWN, ['a', 'b']);
  assert.deepEqual(m.games, ['sanad', 'maani']);
  assert.equal(M.currentGame(m), 'sanad');
  assert.deepEqual(m.pot, { a: 0, b: 0 });
});

test('لا تتجاوز المباراة MAX_GAMES', () => {
  const m = M.createMatch([...KNOWN, ...KNOWN], KNOWN, ['a', 'b']);
  assert.equal(m.games.length, M.MAX_GAMES);
});

test('الفائز يأخذ الوعاء كاملاً والتعادل يقسمه', () => {
  const m = fresh();
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: { a: 19, b: 5 }, playerIds: ['a', 'b'] });
  assert.deepEqual(m.pot, { a: M.POT_WIN, b: 0 });

  M.advance(m);
  M.recordRound(m, { game: 'sanad', winnerId: null, scores: { a: 6, b: 6 }, playerIds: ['a', 'b'] });
  assert.deepEqual(m.pot, { a: M.POT_WIN + M.POT_TIE, b: M.POT_TIE });
});

test('سلالم الألعاب المتباعدة لا تُرجّح شيئاً — الوعاء ثابت', () => {
  const m = fresh();
  // سحقٌ في «مَعاني» (٢٤ مقابل صفر) ثم فوزٌ بفارق نقطةٍ في «سَنَد»
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: { a: 24, b: 0 }, playerIds: ['a', 'b'] });
  M.advance(m);
  M.recordRound(m, { game: 'sanad', winnerId: 'b', scores: { a: 5, b: 6 }, playerIds: ['a', 'b'] });
  assert.equal(m.pot.a, m.pot.b, 'الفوزان متكافئان مهما تباعد فارقهما');
});

test('تسجيل الجولة نفسها مرّتين لا يصرف وعاءها مرّتين', () => {
  const m = fresh();
  const first = M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  const again = M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  assert.ok(first, 'الأولى تُسجَّل');
  assert.equal(again, null, 'والثانية تُهمَل');
  assert.equal(m.pot.a, M.POT_WIN);
  assert.equal(m.results.length, 1);
});

test('لا تقدّم قبل حسم الجولة الجارية', () => {
  const m = fresh();
  assert.equal(M.advance(m), null, 'الجولة لم تنتهِ');
  assert.equal(m.idx, 0);
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  assert.equal(M.advance(m), 'sanad');
  assert.equal(m.idx, 1);
});

test('المباراة تنتهي بانتهاء آخر جولة ولا تتقدّم بعدها', () => {
  const m = fresh(['maani', 'sanad']);
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  assert.equal(M.isLastRound(m), false);
  M.advance(m);
  assert.equal(M.isLastRound(m), true, 'الجولة الأخيرة');
  M.recordRound(m, { game: 'sanad', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  assert.equal(M.isOver(m), true);
  assert.equal(M.advance(m), null, 'لا لعبة بعدها');
  assert.equal(m.idx, 1, 'ولا يتحرّك المؤشّر');
});

test('من فاز بلعبتين فاز بالمباراة ولو خسر الثالثة', () => {
  const m = fresh();
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  M.advance(m);
  M.recordRound(m, { game: 'sanad', winnerId: 'b', scores: {}, playerIds: ['a', 'b'] });
  M.advance(m);
  M.recordRound(m, { game: 'man-ana', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  assert.equal(M.leader(m), 'a');
  assert.equal(M.viewFor(m, 'a').iLead, true);
  assert.equal(M.viewFor(m, 'b').iLead, false);
});

test('التعادل في المباراة ممكن', () => {
  const m = fresh(['maani', 'sanad']);
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: {}, playerIds: ['a', 'b'] });
  M.advance(m);
  M.recordRound(m, { game: 'sanad', winnerId: 'b', scores: {}, playerIds: ['a', 'b'] });
  assert.equal(M.leader(m), null);
  assert.equal(M.viewFor(m, 'a').tied, true);
});

test('لاعبٌ انضمّ بعد الإنشاء يأخذ مقعده في الوعاء', () => {
  const m = M.createMatch(['maani'], KNOWN, ['a']);
  assert.deepEqual(Object.keys(m.pot), ['a']);
  M.seat(m, 'b');
  assert.equal(m.pot.b, 0);
  M.seat(m, 'b');
  assert.equal(Object.keys(m.pot).length, 2, 'ولا يُكرَّر مقعده');
});

test('اللقطة متماثلة إلا في تمييز «أنا»', () => {
  const m = fresh();
  M.recordRound(m, { game: 'maani', winnerId: 'a', scores: { a: 19, b: 5 }, playerIds: ['a', 'b'] });
  const va = M.viewFor(m, 'a');
  const vb = M.viewFor(m, 'b');
  assert.equal(va.myPot, M.POT_WIN);
  assert.equal(va.oppPot, 0);
  assert.equal(vb.myPot, 0);
  assert.equal(vb.oppPot, M.POT_WIN);
  assert.equal(va.roundNo, 1);
  assert.equal(va.total, 3);
  assert.deepEqual(va.results[0], { game: 'maani', iWon: true, tie: false, mine: M.POT_WIN });
  assert.deepEqual(vb.results[0], { game: 'maani', iWon: false, tie: false, mine: 0 });
});
