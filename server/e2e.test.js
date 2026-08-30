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
    env: { ...process.env, PORT: String(PORT), ANTHROPIC_API_KEY: '' },
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

  await t.test('بطاقة البيت تُلعب وتُقيَّم', async () => {
    first.send('play-card', { cardId: 'bayt' });
    assert.ok(await until(() => first.state.trial.playedThisPhase?.cardId === 'bayt'));
    assert.equal(second.state.trial.playedThisPhase, null, 'الخصم لا يراها');
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

  await t.test('البطاقة المستهلكة لا تُلعب ثانيةً', async () => {
    const errs = first.errors.length;
    first.send('play-card', { cardId: 'bayt' });
    await settle();
    assert.ok(first.errors.length > errs, 'رُفضت');
  });

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
