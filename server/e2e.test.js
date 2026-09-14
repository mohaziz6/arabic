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
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '', REVEAL_MS: '0', CLUE_MS: '400' },
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

/* ─────────── مَعاني ─────────── */

async function maaniRoom(nameA = 'أ', nameB = 'ب') {
  const a = client(); await a.open;
  a.send('create', { game: 'maani', name: nameA });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { game: 'maani', code: a.state.code, name: nameB });
  await until(() => b.state?.me);
  return { a, b };
}

test('مَعاني: سباقٌ كامل — الأسرع يكسب، والجواب محجوب حتى الكشف', async () => {
  const { a, b } = await maaniRoom('محمد', 'خالد');
  a.send('maani-start');
  assert.ok(await until(() => a.state?.phase === 'ask'), 'بدأ السباق');

  assert.equal(a.state.progress.questions, 12, 'اثنا عشر سؤالاً');
  assert.equal(a.state.level.id, 'pair', 'يبدأ بالمقابلة');
  assert.deepEqual(a.state.question, b.state.question, 'السؤال نفسه للخصمين');
  assert.equal(a.state.solution, null, 'الجواب لا يغادر الخادم قبل الكشف');
  assert.equal(JSON.stringify(a.state).includes('"why"'), false, 'ولا تعليله');

  // لكلٍّ إجابةٌ واحدة، والجواب غير معروف للعميل عمداً — فيجيب كلٌّ بغير ما أجاب
  a.send('maani-answer', { choice: 'synonym' });
  await settle(180);
  if (a.state.phase === 'ask') b.send('maani-answer', { choice: 'antonym' });
  assert.ok(await until(() => a.state?.phase === 'reveal'), 'أُغلق السؤال بعد إجابتهما');

  await settle(150);
  assert.ok(a.state.solution.answer, 'كُشف الجواب');
  assert.equal(b.state.solution.answer, a.state.solution.answer, 'ويصل الطرفين');
  assert.equal(b.state.oppAnswer?.choice != null, true, 'ويُكشف اختيار الخصم');

  const scored = a.state.scores[a.id] + a.state.scores[b.id];
  assert.ok(scored === 0 || scored === 1, `نقاط المستوى الأول واحدة: ${scored}`);

  b.send('maani-next');
  assert.ok(await until(() => a.state?.progress.question === 2), 'انتقل الطرفان معاً');
  a.ws.close(); b.ws.close();
});

test('مَعاني: من أخطأ خرج وحده، ولا يجيب مرتين', async () => {
  const { a, b } = await maaniRoom();
  a.send('maani-start');
  await until(() => a.state?.phase === 'ask');

  a.send('maani-answer', { choice: 'synonym' });
  await settle(200);

  if (a.state.phase === 'ask') {                 // أخطأ: يبقى السؤال لخصمه
    assert.equal(a.state.myAnswer.correct, false);
    assert.equal(b.state.oppAnswered, true, 'يرى الخصم أن الميدان خلا له');
    assert.equal(b.state.myAnswer, null, 'وهو لم يُجب بعد');

    const errs = a.errors.length;
    a.send('maani-answer', { choice: 'antonym' });
    assert.ok(await until(() => a.errors.length > errs), 'رُفضت إجابته الثانية');
  } else {
    assert.equal(a.state.solution.winnerId, a.id, 'أصاب فأخذها');
  }
  a.ws.close(); b.ws.close();
});

test('رسالة من لعبة أخرى لا تمسّ غرفة مَعاني', async () => {
  const { a, b } = await maaniRoom();
  a.send('maani-start');
  await until(() => a.state?.phase === 'ask');
  const asked = JSON.stringify(a.state.question);

  for (const t of ['start-trial', 'advance', 'next-trial', 'sanad-start', 'sanad-next']) a.send(t);
  a.send('play-card', { cardId: 'bayt' });
  a.send('sanad-rule', { ruling: 'liar' });
  a.send('speech', { transcript: 'مرافعة في لعبة لا قاضي فيها' });
  await settle(700);

  assert.equal(a.state.game, 'maani', 'ما زالت مَعاني');
  assert.equal(a.state.phase, 'ask', 'المرحلة سليمة');
  assert.equal(JSON.stringify(a.state.question), asked, 'السؤال لم يتبدّل');
  a.ws.close(); b.ws.close();
});

test('رسالة من مَعاني لا تمسّ غرفة سَنَد', async () => {
  const { a, b } = await sanadRoom();
  a.send('sanad-start');
  await until(() => a.state?.phase === 'pick');
  const figureBefore = a.state.figure.id;

  a.send('maani-start');
  a.send('maani-answer', { choice: 'synonym' });
  a.send('maani-next');
  await settle(500);

  assert.equal(a.state.game, 'sanad');
  assert.equal(a.state.phase, 'pick');
  assert.equal(a.state.figure.id, figureBefore);
  a.ws.close(); b.ws.close();
});

test('الانضمام إلى ديوان مَعاني بلعبة أخرى يُرفض', async () => {
  const { a, b } = await maaniRoom();
  const c = client(); await c.open;
  c.send('join', { game: 'sanad', code: a.state.code, name: 'ج' });
  assert.ok(await until(() => c.errors.length > 0), 'رُفض');
  assert.ok(c.errors[0].includes('مَعاني'), `يذكر اللعبة: ${c.errors[0]}`);
  a.ws.close(); b.ws.close(); c.ws.close();
});

/* ─────────── من أنا ─────────── */

async function whoRoom(nameA = 'أ', nameB = 'ب') {
  const a = client(); await a.open;
  a.send('create', { game: 'man-ana', name: nameA });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { game: 'man-ana', code: a.state.code, name: nameB });
  await until(() => b.state?.me);
  return { a, b };
}

/** اسم الشخصية الجارية — يُقرأ من البنك لا من اللقطة، فاللقطة تحجبه عمداً. */
async function currentName(c) {
  const { FIGURES } = await import('./man-ana-figures.js');
  const first = c.state.clues[0];
  return FIGURES.find((f) => f.clues[0] === first)?.name;
}

test('من أنا: التلميح يتقدّم من الخادم، والقيمة تتناقص معه', async () => {
  const { a, b } = await whoRoom('محمد', 'خالد');
  a.send('man-ana-start');
  assert.ok(await until(() => a.state?.phase === 'clues'), 'بدأت الجلسة');

  assert.equal(a.state.clues.length, 1, 'تلميح واحد في البداية');
  assert.equal(a.state.points, 6, 'وأعلى قيمة');
  assert.deepEqual(a.state.clues, b.state.clues, 'التلميح نفسه للخصمين');
  assert.equal(a.state.answer, null, 'الجواب محجوب');
  assert.equal(JSON.stringify(a.state).includes('aliases'), false, 'صيغ الجواب لا تُرسل');

  // الخادم هو الذي يقود الإيقاع — بلا أن يطلب أحدٌ شيئاً
  assert.ok(await until(() => a.state?.clues.length === 2, 3000), 'وصل التلميح الثاني تلقائياً');
  assert.equal(a.state.points, 5, 'ورخصت الشخصية');
  assert.equal(b.state.clues.length, 2, 'ووصل الخصم أيضاً');
  assert.ok(a.state.clueMsLeft > 0, 'ومعه ما تبقّى من الدورة');

  a.ws.close(); b.ws.close();
});

test('من أنا: الإصابة تأخذ قيمة التلميح وتوقف المؤقّت', async () => {
  const { a, b } = await whoRoom();
  a.send('man-ana-start');
  await until(() => a.state?.phase === 'clues');

  const name = await currentName(a);
  a.send('man-ana-guess', { text: name });
  assert.ok(await until(() => a.state?.phase === 'reveal'), 'حُلّت الشخصية');

  assert.equal(a.state.solvedBy, a.id);
  assert.equal(a.state.scores[a.id], 6);
  assert.equal(a.state.answer.name, name, 'كُشف الاسم');
  assert.equal(b.state.answer.name, name, 'ويصل الخصم');

  const cluesAtSolve = a.state.clues.length;
  await settle(1200);                       // ثلاث دورات لو بقي المؤقّت يعمل
  assert.equal(a.state.clues.length, cluesAtSolve, 'وقف المؤقّت بعد الحلّ');
  assert.equal(a.state.phase, 'reveal');

  a.ws.close(); b.ws.close();
});

test('من أنا: الخطأ يُقفل صاحبه حتى التلميح التالي، ويراه خصمه بنصّه', async () => {
  const { a, b } = await whoRoom('محمد', 'خالد');
  a.send('man-ana-start');
  await until(() => a.state?.phase === 'clues');

  a.send('man-ana-guess', { text: 'شخصية لا وجود لها' });
  assert.ok(await until(() => a.state?.iLocked), 'أُقفل المخطئ');
  assert.equal(b.state.iLocked, false, 'وخصمه حرّ');
  assert.equal(b.state.oppLocked, true, 'ويعلم أنه أخطأ');
  assert.equal(b.state.misses[0].text, 'شخصية لا وجود لها', 'ويرى نصّ تخمينه');
  assert.equal(b.state.misses[0].mine, false);
  assert.equal(a.state.misses[0].mine, true);

  assert.ok(await until(() => a.state?.iLocked === false, 3000), 'فُكّ القفل مع التلميح التالي');
  a.ws.close(); b.ws.close();
});

test('من أنا: نفاد التلميحات يطوي الشخصية بلا نقاط', async () => {
  const { a, b } = await whoRoom();
  a.send('man-ana-start');
  await until(() => a.state?.phase === 'clues');

  assert.ok(await until(() => a.state?.phase === 'reveal', 8000), 'انقضت التلميحات');
  assert.equal(a.state.solvedBy, null);
  assert.equal(a.state.scores[a.id], 0);
  assert.equal(a.state.scores[b.id], 0);
  assert.ok(a.state.answer.name, 'ومع ذلك يُكشف الاسم');

  a.send('man-ana-next');
  assert.ok(await until(() => a.state?.progress.figure === 2), 'وانتقل الطرفان');
  assert.equal(a.state.clues.length, 1, 'بشخصيةٍ نظيفة');
  a.ws.close(); b.ws.close();
});

test('رسالة من لعبة أخرى لا تمسّ غرفة «من أنا»', async () => {
  const { a, b } = await whoRoom();
  a.send('man-ana-start');
  await until(() => a.state?.phase === 'clues');
  const before = a.state.clues[0];

  for (const t of ['start-trial', 'sanad-start', 'maani-start', 'maani-next', 'next-trial']) a.send(t);
  a.send('maani-answer', { choice: 'synonym' });
  a.send('sanad-rule', { ruling: 'liar' });
  await settle(300);

  assert.equal(a.state.game, 'man-ana');
  assert.equal(a.state.clues[0], before, 'الشخصية لم تتبدّل');
  a.ws.close(); b.ws.close();
});

test('الانضمام إلى ديوان «من أنا» بلعبة أخرى يُرفض', async () => {
  const { a, b } = await whoRoom();
  const c = client(); await c.open;
  c.send('join', { game: 'maani', code: a.state.code, name: 'ج' });
  assert.ok(await until(() => c.errors.length > 0), 'رُفض');
  assert.ok(c.errors[0].includes('مَن أنا'), `يذكر اللعبة: ${c.errors[0]}`);
  a.ws.close(); b.ws.close(); c.ws.close();
});

/* ─────────── المزاد ─────────── */

async function mazadRoom(nameA = 'أ', nameB = 'ب') {
  const a = client(); await a.open;
  a.send('create', { game: 'mazad', name: nameA });
  await until(() => a.state?.code);
  const b = client(); await b.open;
  b.send('join', { game: 'mazad', code: a.state.code, name: nameB });
  await until(() => b.state?.me);
  return { a, b };
}

test('المزاد: الشرط يُكتب فيراه الطرفان، ثم يتزايدان بالتناوب', async () => {
  const { a, b } = await mazadRoom('محمد', 'خالد');
  a.send('mazad-start');
  assert.ok(await until(() => a.state?.phase === 'setup'), 'فُتح الديوان');

  a.send('mazad-config', { patch: { text: 'اعطني أسماء من المبشرين بالجنة', seconds: 45, points: 7 } });
  assert.ok(await until(() => b.state?.round.text.includes('المبشرين')), 'الشرط وصل الخصم');
  assert.equal(b.state.round.seconds, 45, 'والوقت');
  assert.equal(b.state.round.points, 7, 'والنقاط');

  a.send('mazad-open', { amount: 5 });
  assert.ok(await until(() => b.state?.phase === 'bidding'), 'فُتح المزاد');
  assert.equal(b.state.round.myTurn, true, 'والدور للخصم');
  assert.equal(a.state.round.myTurn, false);

  const errs = a.errors.length;
  a.send('mazad-raise', { amount: 9 });          // ليس دوره
  await settle(200);
  assert.equal(a.state.round.bid, 5, 'لم تُقبل مزايدة من غير صاحب الدور');
  assert.ok(a.errors.length > errs, 'ووصله سببُ الرفض — لا صمت في لعبة أدواتها مشتركة');
  assert.ok(a.errors.at(-1).includes('دورك'), `السبب: ${a.errors.at(-1)}`);

  b.send('mazad-raise', { amount: 9 });
  assert.ok(await until(() => a.state?.round.bid === 9), 'زايد صاحب الدور');
  assert.equal(a.state.round.raises, 2, 'وعدّاد الزيادات يرتفع');
  assert.equal(a.state.round.myTurn, true, 'ورجع الدور');

  a.ws.close(); b.ws.close();
});

test('المزاد: «عليك هاتها» ثم الإجابات من الطرفين ثم الحكم', async () => {
  const { a, b } = await mazadRoom('محمد', 'خالد');
  a.send('mazad-start');
  await until(() => a.state?.phase === 'setup');
  a.send('mazad-config', { patch: { text: 'أسماء الخلفاء الراشدين', points: 4 } });
  await until(() => a.state?.round.text);
  a.send('mazad-open', { amount: 3 });
  await until(() => b.state?.phase === 'bidding');
  b.send('mazad-raise', { amount: 4 });
  await until(() => a.state?.round.bid === 4);

  a.send('mazad-hand');
  assert.ok(await until(() => b.state?.phase === 'challenge'), 'سُلِّم التحدي');
  assert.equal(b.state.round.iChallenge, true, 'والمتحدّي هو من زايد');
  assert.equal(a.state.round.iChallenge, false);

  // كلاهما يضيف — أدوات مشتركة في لعبة يدويّة
  b.send('mazad-answer', { text: 'أبو بكر' });
  a.send('mazad-answer', { text: 'عمر' });
  assert.ok(await until(() => a.state?.round.answers.length === 2), 'أُضيفت من الطرفين');
  assert.deepEqual(a.state.round.answers.map((x) => x.text), ['أبو بكر', 'عمر']);

  // حذفٌ بموضعٍ مختومٍ بنصّه: ختمٌ لا يطابق يُرفض ولا يحذف شارةً أخرى
  const stale = a.errors.length;
  a.send('mazad-remove', { index: 0, text: 'عمر' });
  await settle(200);
  assert.equal(a.state.round.answers.length, 2, 'ختمٌ لا يطابق الموضعَ لا يحذف');
  assert.ok(a.errors.length > stale, 'ويُخبَر صاحبه');

  a.send('mazad-remove', { index: 0, text: 'أبو بكر' });
  assert.ok(await until(() => b.state?.round.answers.length === 1), 'وحُذفت');
  assert.equal(b.state.round.answers[0].text, 'عمر');

  b.send('mazad-judge', { done: true });
  assert.ok(await until(() => a.state?.phase === 'judged'), 'صدر الحكم');
  assert.equal(a.state.scores[b.id], 4, 'المتحدّي أخذ نقاط الجولة');
  assert.equal(a.state.scores[a.id], 0);

  a.ws.close(); b.ws.close();
});

test('المزاد: من عجز تذهب نقاطه لخصمه، والجولة التالية نظيفة', async () => {
  const { a, b } = await mazadRoom();
  a.send('mazad-start');
  await until(() => a.state?.phase === 'setup');
  a.send('mazad-config', { patch: { text: 'شرط', points: 6 } });
  await until(() => a.state?.round.text === 'شرط');
  a.send('mazad-open', { amount: 20 });
  await until(() => b.state?.phase === 'bidding');
  b.send('mazad-hand');                         // ب يسلّمها لأ (صاحب آخر مزايدة)
  assert.ok(await until(() => a.state?.round.iChallenge), 'أ هو المتحدّي');

  a.send('mazad-judge', { done: false });
  assert.ok(await until(() => b.state?.phase === 'judged'), 'صدر الحكم');
  assert.equal(b.state.scores[b.id], 6, 'من سلّمها أخذها لأن خصمه عجز');
  assert.equal(b.state.scores[a.id], 0);

  b.send('mazad-next');
  assert.ok(await until(() => a.state?.roundNo === 2), 'جولة ثانية');
  assert.equal(a.state.phase, 'setup');
  assert.equal(a.state.round.text, '', 'بشرطٍ جديد');
  assert.equal(a.state.round.points, 6, 'والنقاط المضبوطة باقية');
  a.ws.close(); b.ws.close();
});

test('المزاد: المؤقّت يجري ويتوقف ويُمدّ من الطرفين، ويرنّ عند الصفر', async () => {
  const { a, b } = await mazadRoom();
  a.send('mazad-start');
  await until(() => a.state?.phase === 'setup');
  a.send('mazad-config', { patch: { text: 'شرط', seconds: 5 } });
  await until(() => a.state?.round.seconds === 5);
  a.send('mazad-open', { amount: 2 });
  await until(() => b.state?.phase === 'bidding');
  b.send('mazad-hand');
  await until(() => a.state?.phase === 'challenge');

  a.send('mazad-timer', { action: 'start' });
  assert.ok(await until(() => b.state?.round.timer.running), 'انطلق عند الطرفين');

  b.send('mazad-timer', { action: 'pause' });    // الخصم يوقفه — أدوات مشتركة
  assert.ok(await until(() => a.state?.round.timer.running === false), 'وأوقفه خصمه');

  const before = a.state.round.timer.leftMs;
  a.send('mazad-timer', { action: 'adjust', delta: 10 });
  assert.ok(await until(() => a.state?.round.timer.leftMs > before + 8000), 'ومُدّ عشر ثوانٍ');

  a.send('mazad-timer', { action: 'reset' });
  assert.ok(await until(() => Math.abs(a.state.round.timer.leftMs - 5000) < 300), 'وصُفِّر');
  a.ws.close(); b.ws.close();
});

test('المزاد: الجلسة تنتهي متى شاءا بفائز', async () => {
  const { a, b } = await mazadRoom();
  a.send('mazad-start');
  await until(() => a.state?.phase === 'setup');
  a.send('mazad-config', { patch: { text: 'شرط' } });
  await until(() => a.state?.round.text === 'شرط');
  a.send('mazad-open', { amount: 3 });
  await until(() => b.state?.phase === 'bidding');
  b.send('mazad-hand');
  await until(() => a.state?.phase === 'challenge');
  a.send('mazad-judge', { done: true });
  await until(() => a.state?.phase === 'judged');

  a.send('mazad-end');
  assert.ok(await until(() => b.state?.status === 'over'), 'انتهت');
  assert.equal(b.state.winnerId, a.id, 'والفائز صاحب الرصيد');
  a.ws.close(); b.ws.close();
});

test('رسالة من لعبة أخرى لا تمسّ غرفة المزاد', async () => {
  const { a, b } = await mazadRoom();
  a.send('mazad-start');
  await until(() => a.state?.phase === 'setup');

  for (const t of ['start-trial', 'sanad-start', 'maani-start', 'man-ana-start', 'man-ana-next']) a.send(t);
  a.send('maani-answer', { choice: 'synonym' });
  a.send('man-ana-guess', { text: 'المتنبي' });
  await settle(300);

  assert.equal(a.state.game, 'mazad');
  assert.equal(a.state.phase, 'setup', 'المرحلة سليمة');
  a.ws.close(); b.ws.close();
});

test('الانضمام إلى ديوان المزاد بلعبة أخرى يُرفض', async () => {
  const { a, b } = await mazadRoom();
  const c = client(); await c.open;
  c.send('join', { game: 'man-ana', code: a.state.code, name: 'ج' });
  assert.ok(await until(() => c.errors.length > 0), 'رُفض');
  assert.ok(c.errors[0].includes('المزاد'), `يذكر اللعبة: ${c.errors[0]}`);
  a.ws.close(); b.ws.close(); c.ws.close();
});
