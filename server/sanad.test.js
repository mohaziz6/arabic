import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIGURES, FIGURE_BY_ID, QUESTIONS, POINTS } from './sanad-figures.js';

test('لكل شخصية الأسئلة الثلاثة، ولكل سؤال الأنواع الثلاثة', () => {
  assert.ok(FIGURES.length >= 4, 'مخزون يكفي جلسة');
  for (const f of FIGURES) {
    assert.ok(f.id && f.name && f.era, `${f.id}: بيانات التعريف كاملة`);
    for (const q of QUESTIONS) {
      const opts = f[q.id];
      assert.equal(opts?.length, 3, `${f.name} / ${q.id}: ثلاثة خيارات`);
      assert.deepEqual(
        opts.map((o) => o.kind).sort(),
        ['absurd', 'crafted', 'true'],
        `${f.name} / ${q.id}: نوع واحد من كل صنف`,
      );
      for (const o of opts) {
        assert.ok(o.text.length > 40, `${f.name} / ${q.id} / ${o.kind}: نص مكتوب`);
      }
    }
  }
});

test('المعرّفات فريدة والفهرس مطابق', () => {
  const ids = FIGURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'لا تكرار في المعرّفات');
  assert.equal(Object.keys(FIGURE_BY_ID).length, FIGURES.length);
});

test('سلّم النقاط: الصحيح أرخص والفاضح أغلى', () => {
  assert.equal(POINTS.true, 1);
  assert.equal(POINTS.crafted, 3);
  assert.equal(POINTS.absurd, 5);
  assert.ok(POINTS.true < POINTS.crafted && POINTS.crafted < POINTS.absurd,
    'المخاطرة تُكافأ تصاعدياً');
});

test('الخيارات داخل السؤال الواحد لا تتشابه نصّاً', () => {
  for (const f of FIGURES) {
    for (const q of QUESTIONS) {
      const texts = f[q.id].map((o) => o.text);
      assert.equal(new Set(texts).size, 3, `${f.name} / ${q.id}: نصوص متمايزة`);
    }
  }
});
