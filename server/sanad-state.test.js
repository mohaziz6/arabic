import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from './sanad.js';
import { QUESTIONS, POINTS } from './sanad-figures.js';

const fixedDeck = (n) => ['mutanabbi', 'jahiz', 'khansa', 'hatim'].slice(0, n);

function started() {
  const s = G.createSession('AB12', 'p1', 'محمد');
  G.addPlayer(s, 'p2', 'خالد');
  G.startSession(s, fixedDeck);
  return s;
}

test('الأدوار متساوية: كل لاعب يروي عن شخصيتين بالتناوب', () => {
  const s = started();
  assert.equal(s.deck.length, 4);
  assert.deepEqual(s.narrators, ['p1', 'p2', 'p1', 'p2']);
  assert.equal(s.narrators.filter((n) => n === 'p1').length,
               s.narrators.filter((n) => n === 'p2').length, 'عدد متساوٍ');
});

test('الخيارات الثلاثة تصل الراوي وحده، وبنقاطها', () => {
  const s = started();
  const nar = G.narratorId(s);
  const opts = G.viewFor(s, nar).options;
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.map((o) => o.points).sort((a, b) => a - b), [1, 3, 5]);
  assert.equal(G.viewFor(s, G.listenerId(s)).options, null, 'الخصم لا يراها');
});

test('الخصم لا يرى نوع الرواية ولا نقاطها قبل الحكم', () => {
  const s = started();
  G.choose(s, G.narratorId(s), 'absurd');
  const v = G.viewFor(s, G.listenerId(s));
  assert.ok(v.told.hint.length > 5, 'يرى التلميح');
  assert.equal(v.told.text, null, 'لا يرى بقيتها');
  assert.equal(v.told.kind, null, 'لا يرى نوعها');
  assert.equal(v.told.points, null, 'ولا نقاطها');
  assert.equal(v.truth, null, 'ولا الحقيقة');
  // ولا حتى الراوي يرى الحقيقة قبل الكشف
  assert.equal(G.viewFor(s, G.narratorId(s)).truth, null);
});

test('لا يختار إلا الراوي، ولا يحكم إلا الخصم', () => {
  const s = started();
  const nar = G.narratorId(s);
  const lis = G.listenerId(s);
  assert.equal(G.choose(s, lis, 'true').ok, false, 'الخصم لا يختار');
  assert.equal(G.choose(s, nar, 'true').ok, true);
  assert.equal(G.rule(s, nar, 'trust').ok, false, 'الراوي لا يحكم على نفسه');
  assert.equal(G.rule(s, lis, 'trust').ok, true);
});

test('المُحقّ يأخذ نقاط الخيار — الحالات الست', () => {
  const cases = [
    { kind: 'true',    ruling: 'trust', winner: 'listener', pts: 1 },
    { kind: 'true',    ruling: 'liar',  winner: 'narrator', pts: 1 },
    { kind: 'crafted', ruling: 'trust', winner: 'narrator', pts: 3 },
    { kind: 'crafted', ruling: 'liar',  winner: 'listener', pts: 3 },
    { kind: 'absurd',  ruling: 'trust', winner: 'narrator', pts: 5 },
    { kind: 'absurd',  ruling: 'liar',  winner: 'listener', pts: 5 },
  ];
  for (const c of cases) {
    const s = started();
    const nar = G.narratorId(s);
    const lis = G.listenerId(s);
    G.choose(s, nar, c.kind);
    const r = G.rule(s, lis, c.ruling);
    const expected = c.winner === 'narrator' ? nar : lis;
    assert.equal(r.winnerId, expected, `${c.kind} + ${c.ruling}`);
    assert.equal(s.scores[expected], c.pts, `${c.kind} + ${c.ruling}: ${c.pts} نقطة`);
    assert.equal(s.scores[expected === nar ? lis : nar], 0, 'الخاسر بلا نقاط');
  }
});

test('قول الصدق خدعة مشروعة: صدقتَ فكُذّبتَ فكسبت', () => {
  const s = started();
  const nar = G.narratorId(s);
  G.choose(s, nar, 'true');
  G.rule(s, G.listenerId(s), 'liar');
  assert.equal(s.scores[nar], 1, 'الراوي الصادق المُكذَّب يكسب');
});

test('الكشف يُظهر الحقيقة والنوع والنقاط', () => {
  const s = started();
  G.choose(s, G.narratorId(s), 'crafted');
  G.rule(s, G.listenerId(s), 'liar');
  const v = G.viewFor(s, G.listenerId(s));
  assert.equal(v.phase, 'reveal');
  assert.equal(v.told.kind, 'crafted');
  assert.equal(v.told.points, POINTS.crafted);
  assert.ok(v.truth.length > 20, 'الرواية الصحيحة ظهرت');
  assert.equal(v.ruling, 'liar');
});

test('التقدّم: ثلاثة أسئلة لكل شخصية ثم الشخصية التالية', () => {
  const s = started();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(`${s.figureIndex}:${s.questionIndex}`);
    G.choose(s, G.narratorId(s), 'true');
    G.rule(s, G.listenerId(s), 'trust');
    G.next(s);
  }
  assert.equal(seen[0], '0:0');
  assert.equal(seen[2], '0:2');
  assert.equal(seen[3], '1:0', 'انتقل للشخصية الثانية');
  assert.equal(seen[11], '3:2', 'آخر سؤال في آخر شخصية');
  assert.equal(s.status, 'over');
});

test('الفائز صاحب أعلى رصيد، والتعادل يُعلن', () => {
  const s = started();
  for (let i = 0; i < 12; i++) {
    G.choose(s, G.narratorId(s), 'absurd');
    G.rule(s, G.listenerId(s), 'trust');   // الراوي يخدع دائماً
    G.next(s);
  }
  assert.equal(s.status, 'over');
  // ستّ جولات لكل راوٍ × ٥ نقاط = تعادل
  assert.equal(s.scores.p1, s.scores.p2);
  assert.equal(s.winnerId, null, 'تعادل');
});

test('لا حكم قبل اختيار، ولا انتقال قبل كشف', () => {
  const s = started();
  assert.equal(G.rule(s, G.listenerId(s), 'trust').ok, false, 'لا حكم في مرحلة الاختيار');
  assert.equal(G.next(s).ok, false, 'لا انتقال قبل الكشف');
  G.choose(s, G.narratorId(s), 'true');
  assert.equal(G.next(s).ok, false, 'ولا في مرحلة النقاش');
});

test('لا جلسة بلاعب واحد، ولا تُبدأ مرتين', () => {
  const s = G.createSession('AB12', 'p1', 'م');
  assert.equal(G.startSession(s, fixedDeck).ok, false);
  G.addPlayer(s, 'p2', 'خ');
  assert.equal(G.startSession(s, fixedDeck).ok, true);
  assert.equal(G.startSession(s, fixedDeck).ok, false, 'لا تُبدأ مرتين');
  assert.equal(G.addPlayer(s, 'p3', 'ث').ok, false, 'ولا ثالث');
});

test('الخصم لا يصله إلا تلميح — والرواية كلها لا تغادر الخادم', () => {
  const s = started();
  const nar = G.narratorId(s);
  const lis = G.listenerId(s);
  G.choose(s, nar, 'crafted');

  const full = G.viewFor(s, nar).told.text;
  assert.ok(full.length > 60, 'الراوي يرى روايته كاملة');

  const seen = G.viewFor(s, lis).told;
  assert.equal(seen.text, null, 'النصّ الكامل لا يصل الخصم أصلاً');
  assert.equal(seen.hint.trim().split(/\s+/).length, 4, 'تلميح من أربع كلمات');
  assert.ok(!full.includes(seen.hint), 'التلميح مكتوب لا مقتطع من الرواية');

  // ولا يتسرّب شيء من الرواية في اللقطة كاملة
  const dump = JSON.stringify(G.viewFor(s, lis));
  assert.ok(!dump.includes(full.slice(0, 40)), 'الرواية غير موجودة في اللقطة');
});

test('بعد الحكم يرى الطرفان الرواية كاملة', () => {
  const s = started();
  G.choose(s, G.narratorId(s), 'absurd');
  G.rule(s, G.listenerId(s), 'liar');
  const v = G.viewFor(s, G.listenerId(s));
  assert.ok(v.told.text.length > 60, 'كُشفت كاملة');
  assert.equal(v.told.kind, 'absurd');
});
