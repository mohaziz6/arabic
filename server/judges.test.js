import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGES, JUDGE_BY_ID, DEFAULT_JUDGE, publicJudges, pickJudge } from './judges.js';

test('ثلاثة قضاة، لكلٍّ معرّف واسم فريدان', () => {
  assert.equal(JUDGES.length, 3);
  const ids = JUDGES.map((j) => j.id);
  const names = JUDGES.map((j) => j.name);
  assert.equal(new Set(ids).size, 3);
  assert.equal(new Set(names).size, 3);
  assert.ok(ids.includes(DEFAULT_JUDGE), 'الافتراضي موجود');
});

test('لكل قاضٍ شخصية فيها سلّم درجات', () => {
  for (const j of JUDGES) {
    assert.ok(j.persona.length > 400, `${j.name}: شخصية مكتوبة`);
    assert.ok(j.persona.includes('سلّم الدرجات'), `${j.name}: سلّم درجات صريح`);
    assert.ok(j.persona.includes('٠-٢'), `${j.name}: حدّ أدنى للصمت`);
    assert.ok(j.brief && j.epithet && j.warn, `${j.name}: بيانات البطاقة كاملة`);
  }
});

test('الشخصيات مختلفة فعلاً لا نسخاً', () => {
  const personas = new Set(JUDGES.map((j) => j.persona));
  assert.equal(personas.size, 3);
});

test('ما يُرسل للمتصفح لا يحمل نص الشخصية', () => {
  const pub = publicJudges();
  assert.equal(pub.length, 3);
  for (const j of pub) {
    assert.equal(j.persona, undefined, 'الشخصية لا تغادر الخادم');
    assert.ok(j.id && j.name && j.epithet && j.brief);
  }
});

test('القرعة تصيب القضاة الثلاثة جميعاً', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(pickJudge());
  assert.equal(seen.size, 3, 'لا قاضي محجوب عن القرعة');
  for (const id of seen) assert.ok(JUDGE_BY_ID[id], 'معرّف صالح');
});
