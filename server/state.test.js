import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, addPlayer, startTrial, currentSpeaker, currentPhase,
  playCard, canPlayCard, submitSpeech, resolveObjection, recordVerdict, advancePhase,
  isTrialOver, viewFor, opponentOf,
} from './state.js';
import { ROLES, PHASES, WINS_NEEDED } from './rules.js';

const KASE = {
  charge: 'سرقة بحر الطويل',
  defendant: 'شاعر مجهول',
  facts: 'وُجد البحر ناقصاً تفعيلة.',
  cardContent: { mathal: 'الجار قبل الدار', bayt: 'ومن يكُ ذا فمٍ مُرٍّ مريضٍ' },
};

const judged = (score, cardDelta = 0) => ({ score, cardDelta, comment: '' });

function twoPlayerTrial() {
  const s = createSession('AB12', 'p1', 'محمد');
  addPlayer(s, 'p2', 'خالد');
  startTrial(s, KASE);
  advancePhase(s);              // القاضي عرض القضية، فتبدأ المرافعات
  return s;
}

test('الخصم يأخذ الدور المقابل، والثالث يُرفض', () => {
  const s = createSession('AB12', 'p1', 'محمد');
  addPlayer(s, 'p2', 'خالد');
  assert.notEqual(s.players.p1.role, s.players.p2.role);
  assert.equal(addPlayer(s, 'p3', 'ثالث').ok, false);
});

test('الأدوار تتبدّل بين المحاكمات لا داخلها', () => {
  const s = twoPlayerTrial();
  const first = s.players.p1.role;
  submitSpeech(s, currentSpeaker(s).id, 'ن', judged(5));
  assert.equal(s.players.p1.role, first, 'لا تتبدّل داخل المحاكمة');

  recordVerdict(s, 'p1', { summary: 'x' });
  startTrial(s, KASE);
  assert.notEqual(s.players.p1.role, first, 'تتبدّل في المحاكمة التالية');
});

test('ترتيب المراحل: ادعاء ثم دفاع ثم ردّ ثم ردّ', () => {
  const s = twoPlayerTrial();
  const seen = [];
  while (!isTrialOver(s)) {
    const sp = currentSpeaker(s);
    seen.push(sp.role);
    submitSpeech(s, sp.id, 'مرافعة', judged(5));
  }
  assert.deepEqual(seen, [
    ROLES.PROSECUTOR, ROLES.DEFENDER, ROLES.PROSECUTOR, ROLES.DEFENDER,
  ]);
});

test('من ليس دوره لا يترافع، لكنه هو وحده من يرمي السلاح', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  const other = opponentOf(s, speaker);

  assert.equal(submitSpeech(s, other, 'ن', judged(5)).ok, false, 'لا يترافع');
  assert.equal(canPlayCard(s, other, 'fusha').ok, true, 'يرمي على المترافع');
  assert.equal(canPlayCard(s, speaker, 'fusha').ok, false, 'لا يرمي على نفسه');
});

test('سلاح واحد كحد أقصى في المرافعة، ولا يُرمى مرتين في الجلسة', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  const thrower = opponentOf(s, speaker);

  assert.equal(playCard(s, thrower, 'fusha').ok, true);
  assert.equal(playCard(s, thrower, 'mathal').ok, false, 'الثاني يُرفض');

  submitSpeech(s, speaker, 'ن', judged(5));
  assert.equal(currentSpeaker(s).id, thrower, 'تبادل الأدوار: صار الرامي يترافع');

  // الآن الهدف السابق هو الرامي، وبطاقته لم تُستهلك بعد
  assert.equal(playCard(s, speaker, 'fusha').ok, true, 'بطاقته هو لم تُصرف');

  // ولا يرمي سلاحاً ثانياً في نفس المرافعة
  assert.equal(playCard(s, speaker, 'bayt').ok, false, 'سلاح واحد للمرافعة');

  // وحين يعود دوره في الرمي، فصحاه مستهلكة
  submitSpeech(s, thrower, 'ن', judged(5));
  assert.equal(currentSpeaker(s).id, speaker, 'رجعت المرافعة للأول');
  assert.equal(playCard(s, thrower, 'fusha').ok, false, 'مستهلكة من مرافعة سابقة');
});

test('القيد المرمي ظاهر للطرفين — الهدف يجب أن يراه ليصارعه', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  const thrower = opponentOf(s, speaker);
  playCard(s, thrower, 'bayt');

  assert.equal(viewFor(s, speaker).trial.imposed.cardId, 'bayt', 'الهدف يراه');
  assert.equal(viewFor(s, thrower).trial.imposed.cardId, 'bayt', 'والرامي يراه');
  assert.equal(viewFor(s, speaker).trial.imposed.on, speaker);
});

test('نقاط القيد تقع على المتحدّث لا على الرامي — فالرمي مقامرة', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  const thrower = opponentOf(s, speaker);

  playCard(s, thrower, 'bayt');
  submitSpeech(s, speaker, 'ن', judged(6, 4));       // كسر القيد
  assert.equal(s.trial.scores[speaker], 10, 'المتحدّث ربح المكافأة');
  assert.equal(s.trial.scores[thrower], 0, 'الرامي لم يربح شيئاً');
});

test('البطاقات المولَّدة تحمل محتوى القضية', () => {
  const s = twoPlayerTrial();
  const bayt = s.players.p1.hand.find((c) => c.id === 'bayt');
  assert.equal(bayt.content, KASE.cardContent.bayt);
  const fusha = s.players.p1.hand.find((c) => c.id === 'fusha');
  assert.equal(fusha.content, null, 'الفصحى قاعدة بلا محتوى');
});

test('الاعتراض يُرمى في دور الخصم فقط، ونقاطه على الرامي', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  const listener = opponentOf(s, speaker);

  assert.equal(playCard(s, speaker, 'objection').ok, false, 'لا تعترض على نفسك');
  assert.equal(playCard(s, listener, 'objection').ok, true);
  assert.ok(s.trial.pendingObjection, 'الاعتراض معلّق فيوقف المؤقّت');

  resolveObjection(s, true);
  assert.equal(s.trial.scores[listener], 3, 'اعتراض مقبول يمنح');
  assert.equal(s.trial.pendingObjection, null);
});

test('الاعتراض المرفوض يخصم', () => {
  const s = twoPlayerTrial();
  const listener = opponentOf(s, currentSpeaker(s).id);
  playCard(s, listener, 'objection');
  resolveObjection(s, false);
  assert.equal(s.trial.scores[listener], -3);
});

test('العجز عن القيد يخصم من المتحدّث', () => {
  const s = twoPlayerTrial();
  const speaker = currentSpeaker(s).id;
  playCard(s, opponentOf(s, speaker), 'bayt');
  submitSpeech(s, speaker, 'ن', judged(6, -3));      // عجز عن إدخال البيت
  assert.equal(s.trial.scores[speaker], 3);
});

test('أول من يبلغ عدد الأحكام يفوز بالجلسة', () => {
  const s = twoPlayerTrial();
  for (let i = 0; i < WINS_NEEDED; i++) {
    recordVerdict(s, 'p1', { summary: 'x' });
    if (s.status !== 'session-over') startTrial(s, KASE);
  }
  assert.equal(s.status, 'session-over');
  assert.equal(s.winnerId, 'p1');
  assert.equal(s.wins.p1, WINS_NEEDED);
});

test('ثلاث محاكمات بلا فائز متكرر تُحسم بالرصيد، والتعادل يُعلن', () => {
  const s = twoPlayerTrial();
  recordVerdict(s, 'p1', {});
  startTrial(s, KASE);
  recordVerdict(s, 'p2', {});
  startTrial(s, KASE);
  recordVerdict(s, null, {});          // محاكمة ثالثة بلا فائز
  assert.equal(s.status, 'session-over');
  assert.equal(s.winnerId, null, 'تعادل');
});

test('لقطة اللاعب لا تسرّب بطاقات الخصم', () => {
  const s = twoPlayerTrial();
  const v = viewFor(s, 'p1');

  // الخصم يُرى بحقول معدودة — العدد فقط لا هوية البطاقات
  assert.deepEqual(
    Object.keys(v.opponent).sort(),
    ['cardsLeft', 'connected', 'id', 'name', 'role'],
  );
  assert.equal(v.opponent.cardsLeft, 4);
  assert.equal(v.me.hand.length, 4);
});



test('لا محاكمة قبل اكتمال اللاعبَين', () => {
  const s = createSession('AB12', 'p1', 'محمد');
  assert.equal(startTrial(s, KASE).ok, false);
});

test('عدد المراحل يطابق الجدول', () => {
  assert.equal(PHASES.length, 6);
  const fresh = createSession('AB12', 'p1', 'م');
  addPlayer(fresh, 'p2', 'خ');
  startTrial(fresh, KASE);
  assert.equal(currentPhase(fresh).id, 'case', 'تبدأ بعرض القضية');
  assert.equal(currentSpeaker(fresh), null, 'لا متحدّث في عرض القضية');
  assert.equal(advancePhase(fresh).ok, true);
  assert.equal(currentPhase(fresh).id, 'opening-pros');
  assert.equal(advancePhase(fresh).ok, false, 'مرحلة المرافعة لا تُتخطّى');
});
