/**
 * اختبار من الطرف للطرف: لاعبان حقيقيان عبر WebSocket يخوضان محاكمة كاملة
 * على القاضي الوهمي — يتحقق من الأدوار والبطاقات والحكم وحجب معلومات الخصم.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8199;
let proc;

before(async () => {
  proc = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '', REVEAL_MS: '0' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try {
      const probe = new WebSocket(`ws://localhost:${PORT}`);
      await new Promise((res, rej) => { probe.on('open', res); probe.on('error', rej); });
      probe.close();
      return;
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('الخادم لم يستجب');
});

after(() => proc?.kill());

/** عميل صغير يجمع اللقطات ورسائل القاضي. */
function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, state: null, id: null, judged: [], errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'state') c.state = m.state;
    if (m.type === 'joined') c.id = m.playerId;
    if (m.type === 'judge') c.judged.push(m);
    if (m.type === 'error') c.errors.push(m.error);
  });
  c.send = (type, extra = {}) => ws.send(JSON.stringify({ type, ...extra }));
  c.open = new Promise((res) => ws.on('open', res));
  return c;
}

const settle = (ms = 220) => new Promise((r) => setTimeout(r, ms));

/** ينتظر حتى يتحقق الشرط أو تنفد المهلة. */
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await settle(60);
  }
  return false;
}

test('محاكمة كاملة بين لاعبَين تنتهي بحكم', async (t) => {
  const a = client(); await a.open;
  a.send('create', { name: 'محمد' });
  assert.ok(await until(() => a.state?.code), 'أُنشئ الديوان');
  const code = a.state.code;

  const b = client(); await b.open;
  b.send('join', { code, name: 'خالد' });
  assert.ok(await until(() => b.state?.me), 'انضم الخصم');

  await t.test('الأدوار متقابلة ولكلٍّ أربع بطاقات', () => {
    assert.notEqual(a.state.me.role, b.state.me.role);
    assert.equal(a.state.me.hand.length, 4);
    assert.equal(a.state.opponent.cardsLeft, 4);
    assert.equal(a.state.opponent.hand, undefined, 'يد الخصم محجوبة');
  });

  a.send('start-trial');
  assert.ok(await until(() => a.state?.trial?.case), 'عُرضت القضية');

  await t.test('القضية تصل الطرفين ومعها محتوى البطاقات', () => {
    assert.ok(a.state.trial.case.charge.length > 5);
    const bayt = a.state.me.hand.find((c) => c.id === 'bayt');
    assert.ok(bayt.content, 'بطاقة البيت تحمل بيتاً');
  });

  a.send('advance');
  assert.ok(await until(() => a.state?.trial?.phase === 'opening-pros'), 'بدأت المرافعات');

  // من دوره الآن؟
  const first = a.state.trial.isMyTurn ? a : b;
  const second = first === a ? b : a;

  await t.test('من ليس دوره يُرفض ترافعه', async () => {
    second.send('speech', { transcript: 'مرافعة في غير دوري' });
    await settle();
    assert.equal(second.state.trial.speeches.length, 0);
  });

  await t.test('السلاح يُرمى على المترافع ويراه الطرفان', async () => {
    // الرامي هو من ليس دوره
    second.send('play-card', { cardId: 'bayt' });
    assert.ok(await until(() => second.state.trial.imposed?.cardId === 'bayt'), 'رُمي');
    assert.ok(await until(() => first.state.trial.imposed?.cardId === 'bayt'),
      'الهدف يراه ليصارعه');
    assert.equal(first.state.trial.imposed.on, first.id, 'مُوجَّه إليه هو');
  });

  // أربع مرافعات
  const SPEECH = 'أيها القاضي إن الوقائع ثابتة والدليل قائم والمتهم لا ينكر ما نُسب إليه في هذه القضية';
  for (let i = 0; i < 4; i++) {
    const turn = a.state.trial.isMyTurn ? a : b;
    const before = turn.state.trial.speeches.length;
    turn.send('speech', { transcript: SPEECH });
    assert.ok(await until(() => turn.state.trial.speeches.length > before), `مرافعة ${i + 1}`);
  }

  await t.test('صدر الحكم وسُجّل للفائز', async () => {
    assert.ok(await until(() => a.state.trial.verdict), 'نُطق الحكم');
    const v = a.state.trial.verdict;
    assert.ok(['prosecutor', 'defender'].includes(v.winner));
    assert.ok(v.spoken.length > 5);
    assert.equal(Object.values(a.state.wins).reduce((x, y) => x + y, 0), 1);
  });

  a.ws.close(); b.ws.close();
});

test('البطاقة المستهلكة لا تُرمى ثانيةً — أثناء مرافعة جارية', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  a.send('start-trial');
  await until(() => a.state?.trial?.case);
  a.send('advance');
  await until(() => a.state?.trial?.phase === 'opening-pros');

  const speaker = a.state.trial.isMyTurn ? a : b;
  const thrower = speaker === a ? b : a;

  thrower.send('play-card', { cardId: 'bayt' });
  assert.ok(await until(() => thrower.state.trial.imposed?.cardId === 'bayt'), 'رُميت');

  // تُنهى المرافعة ليعود الرامي رامياً في مرافعة تالية
  speaker.send('speech', { transcript: 'مرافعة فيها كلام مفهوم عن القضية والدليل' });
  await until(() => a.state.trial.phase === 'opening-def');
  speaker.send('speech', { transcript: 'ردّ فيه كلام مفهوم عن القضية والدليل كذلك' });
  await settle(500);

  // الآن مرحلة ردّ الادعاء: الرامي الأول صار في موضع الرمي ثانيةً وبطاقته مصروفة
  const errs = thrower.errors.length;
  thrower.send('play-card', { cardId: 'bayt' });
  await settle(400);
  assert.ok(thrower.errors.length > errs, 'رُفضت لأنها مستهلكة');
  assert.ok(thrower.errors.at(-1).includes('مستهلكة'), `السبب: ${thrower.errors.at(-1)}`);
  a.ws.close(); b.ws.close();
});

test('رمز غير موجود يُرفض', async () => {
  const c = client(); await c.open;
  c.send('join', { code: 'ZZZZ', name: 'غريب' });
  assert.ok(await until(() => c.errors.length > 0));
  c.ws.close();
});

test('الثالث لا يدخل ديواناً ممتلئاً', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  const c = client(); await c.open;
  c.send('join', { code: a.state.code, name: 'ج' });
  assert.ok(await until(() => c.errors.length > 0), 'رُفض الثالث');
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('ضغطتان على «ارفع الجلسة» لا تُعيدان بدء المحاكمة', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  const role = a.state.me.role;
  a.send('start-trial');
  a.send('start-trial');                 // ضغطة ثانية فورية
  assert.ok(await until(() => a.state?.trial?.case));
  await settle(700);

  assert.equal(a.state.trialNo, 1, 'محاكمة واحدة لا اثنتان');
  assert.equal(a.state.me.role, role, 'الأدوار لم تنقلب');
  a.ws.close(); b.ws.close();
});

test('مرافعة مكررة لا تُسجَّل مرتين ولا تُصرف نقاطاً مضاعفة', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  a.send('start-trial');
  await until(() => a.state?.trial?.case);
  a.send('advance');
  await until(() => a.state?.trial?.phase === 'opening-pros');

  const turn = a.state.trial.isMyTurn ? a : b;
  const scored = turn.judged.filter((m) => typeof m.score === 'number').length;
  turn.send('speech', { transcript: 'مرافعة أولى فيها من الحجج ما يكفي' });
  turn.send('speech', { transcript: 'نفس المرافعة مرسلة مرتين' });
  await settle(900);

  assert.equal(turn.state.trial.speeches.length, 1, 'مرافعة واحدة سُجّلت');
  assert.equal(
    turn.judged.filter((m) => typeof m.score === 'number').length - scored, 1,
    'درجة واحدة أُعلنت',
  );
  a.ws.close(); b.ws.close();
});

test('الملفات السرية لا تُقدَّم عبر HTTP', async () => {
  const blocked = ['/.git/config', '/.env', '/package.json', '/server/judge.js'];
  for (const p of blocked) {
    const r = await fetch(`http://localhost:${PORT}${p}`);
    assert.equal(r.status, 404, `${p} يجب أن يُمنع`);
  }
  const ok = await fetch(`http://localhost:${PORT}/assets/styles.css`);
  assert.equal(ok.status, 200, 'الأصول العامة تُقدَّم');
});

test('الإغراق بالرسائل يُكبح قبل أن يصير فاتورة', async () => {
  const c = client(); await c.open;
  c.send('create', { name: 'أ' });
  await until(() => c.state?.code);

  for (let i = 0; i < 90; i++) c.send('start-trial');
  assert.ok(await until(() => c.errors.some((e) => e.includes('تمهّل'))), 'كُبح');
  c.ws.close();
});

test('القرعة تصل اللاعبَين، والقاضي يثبت للجلسة كلها', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  assert.equal(a.state.judgeId, null, 'لا قاضي قبل رفع الجلسة');

  a.send('start-trial');
  assert.ok(await until(() => a.state?.judgeId), 'أُجريت القرعة');
  const chosen = a.state.judgeId;

  assert.ok(await until(() => b.state?.judgeId === chosen), 'الخصم يرى نفس القاضي');
  assert.ok(['mizan', 'reeh', 'urf'].includes(chosen), 'قاضٍ معروف');

  // القضية الثانية لا تعيد القرعة
  await until(() => a.state?.trial?.case);
  a.send('advance');
  await until(() => a.state?.trial?.phase === 'opening-pros');
  for (let i = 0; i < 4; i++) {
    const turn = a.state.trial.isMyTurn ? a : b;
    const before = turn.state.trial.speeches.length;
    turn.send('speech', { transcript: 'حجة كافية فيها كلام مفهوم عن القضية' });
    await until(() => turn.state.trial.speeches.length > before);
  }
  await until(() => a.state.trial.verdict);

  a.send('next-trial');
  assert.ok(await until(() => a.state.trialNo === 2));
  assert.equal(a.state.judgeId, chosen, 'القاضي نفسه لا يتبدّل بين القضايا');
  a.ws.close(); b.ws.close();
});

test('الدور ينتقل فوراً بلا انتظار القاضي، والنقاط تلحق', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  a.send('start-trial');
  await until(() => a.state?.trial?.case);
  a.send('advance');
  await until(() => a.state?.trial?.phase === 'opening-pros');

  const first = a.state.trial.isMyTurn ? a : b;
  const second = first === a ? b : a;

  const t0 = Date.now();
  first.send('speech', { transcript: 'مرافعة الادعاء فيها حجة مفهومة وكلام عن القضية' });
  assert.ok(await until(() => second.state?.trial?.isMyTurn, 3000), 'انتقل الدور');
  const handoff = Date.now() - t0;
  assert.ok(handoff < 1500, `انتقال الدور سريع (${handoff}ms)`);

  // المرافعة سُجّلت وحكمها يلحق بعدها
  assert.equal(first.state.trial.speeches.length, 1);
  assert.ok(await until(() => first.state.trial.speeches[0].judgement), 'وصل الحكم');
  assert.ok(first.state.trial.scores[first.id] > 0, 'أُضيفت نقاطه');

  a.ws.close(); b.ws.close();
});

test('الحكم النهائي لا يصدر قبل اكتمال تقييم كل المرافعات', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  a.send('start-trial');
  await until(() => a.state?.trial?.case);
  a.send('advance');
  await until(() => a.state?.trial?.phase === 'opening-pros');

  for (let i = 0; i < 4; i++) {
    const turn = a.state.trial.isMyTurn ? a : b;
    const before = turn.state.trial.speeches.length;
    turn.send('speech', { transcript: `مرافعة رقم ${i + 1} فيها حجة مفهومة عن القضية` });
    assert.ok(await until(() => turn.state.trial.speeches.length > before));
  }

  assert.ok(await until(() => a.state.trial.verdict, 8000), 'صدر الحكم');
  assert.equal(a.state.trial.speeches.length, 4);
  assert.equal(a.state.trial.speeches.filter((s) => !s.judgement).length, 0,
    'كل المرافعات مُقيَّمة قبل الحكم');
  a.ws.close(); b.ws.close();
});

/* ─────────── سَنَد ─────────── */

async function sanadRoom(nameA = 'أ', nameB = 'ب') {
  const a = client(); await a.open;
  a.send('create', { game: 'sanad', name: nameA });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { game: 'sanad', code: a.state.code, name: nameB });
  await until(() => b.state?.me);
  return { a, b };
}

test('سَنَد: جولة كاملة — الخيارات للراوي، والحكم للخصم', async () => {
  const { a, b } = await sanadRoom('محمد', 'خالد');
  a.send('sanad-start');
  assert.ok(await until(() => a.state?.phase === 'pick'), 'بدأت الجلسة');

  const nar = a.state.me.isNarrator ? a : b;
  const lis = nar === a ? b : a;

  assert.equal(nar.state.options?.length, 3, 'الراوي يرى ثلاث روايات');
  assert.deepEqual(nar.state.options.map((o) => o.points).sort((x, y) => x - y), [1, 3, 5]);
  assert.equal(lis.state.options, null, 'الخصم لا يراها');

  nar.send('sanad-choose', { kind: 'absurd' });
  assert.ok(await until(() => lis.state?.phase === 'talk'), 'انتقلنا للنقاش');
  assert.equal(lis.state.told.hint.trim().split(/\s+/).length, 4, 'الخصم يرى تلميحاً رباعياً');
  assert.equal(lis.state.told.text, null, 'وبقيتها لا تغادر الخادم');
  assert.equal(lis.state.told.kind, null, 'بلا وسمها');
  assert.equal(lis.state.truth, null, 'ولا الحقيقة');

  lis.send('sanad-rule', { ruling: 'liar' });
  assert.ok(await until(() => lis.state?.phase === 'reveal'), 'صدر الحكم');
  assert.equal(lis.state.told.kind, 'absurd', 'كُشف النوع');
  assert.equal(lis.state.scores[lis.id], 5, 'الكاشف أخذ الخمس');
  assert.ok(lis.state.truth.length > 20, 'ظهرت الحقيقة');

  a.ws.close(); b.ws.close();
});

test('رسالة من المحاكمة لا تُدمّر غرفة سَنَد', async () => {
  const { a, b } = await sanadRoom();
  a.send('sanad-start');
  await until(() => a.state?.phase === 'pick');
  const figureBefore = a.state.figure.id;

  // رسائل المحاكمة كلها — يجب أن تُهمل بلا أثر
  for (const t of ['start-trial', 'advance', 'next-trial', 'retry-verdict']) a.send(t);
  a.send('play-card', { cardId: 'bayt' });
  a.send('speech', { transcript: 'مرافعة في لعبة لا مرافعة فيها' });
  await settle(700);

  assert.equal(a.state.game, 'sanad', 'ما زالت سَنَد');
  assert.equal(a.state.phase, 'pick', 'المرحلة سليمة');
  assert.equal(a.state.figure.id, figureBefore, 'الشخصية لم تتبدّل');
  a.ws.close(); b.ws.close();
});

test('رسالة من سَنَد لا تمسّ غرفة المحاكمة', async () => {
  const a = client(); await a.open;
  a.send('create', { name: 'أ' });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { code: a.state.code, name: 'ب' });
  await until(() => b.state?.me);

  for (const t of ['sanad-start', 'sanad-next']) a.send(t);
  a.send('sanad-choose', { kind: 'absurd' });
  a.send('sanad-rule', { ruling: 'liar' });
  await settle(600);

  assert.equal(a.state.trial, null, 'لا محاكمة بدأت');
  assert.equal(a.state.status, 'lobby');
  a.ws.close(); b.ws.close();
});

test('الانضمام بلعبة مخالفة يُرفض', async () => {
  const { a } = await sanadRoom();
  const c = client(); await c.open;
  c.send('join', { game: 'muhakama', code: a.state.code, name: 'ج' });
  assert.ok(await until(() => c.errors.length > 0), 'رُفض');
  assert.ok(c.errors[0].includes('سَنَد'), `يذكر اللعبة: ${c.errors[0]}`);
  a.ws.close(); c.ws.close();
});
