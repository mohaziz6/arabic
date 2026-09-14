/**
 * اختبار آلة حالات «المزاد» — دوال خالصة.
 * المؤقّت بيانات لا `setTimeout`: كل دالّة تأخذ `now` فيُختبر مرورُ الوقت بحسابٍ
 * لا بانتظار، وتمرّ «دقيقة» في سطرٍ واحد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as M from './mazad.js';

/** جلسةٌ بلاعبَين في مرحلة الإعداد. */
function session() {
  const s = M.createSession('BIDS', 'a', 'أحمد');
  M.addPlayer(s, 'b', 'بدر');
  M.startSession(s);
  return s;
}

/** جلسةٌ وصلت إلى التحدي: أ فتح بخمسة، ب زايد إلى ثمانية، أ سلّمها له. */
function atChallenge(s = session()) {
  M.configure(s, { text: 'اعطني أسماء من المبشرين بالجنة' });
  M.openBidding(s, 'a', 5);
  M.raise(s, 'b', 8);
  M.handOver(s, 'a');
  return s;
}

test('الجلسة تبدأ بالإعداد بقيمٍ افتراضية قابلة للتعديل', () => {
  const s = session();
  assert.equal(s.phase, 'setup');
  assert.equal(s.round.seconds, M.DEFAULT_SECONDS);
  assert.equal(s.round.points, M.DEFAULT_POINTS);
  assert.equal(s.roundNo, 1);
});

test('كلا اللاعبَين يضبط الشرط والوقت والنقاط', () => {
  const s = session();
  assert.equal(M.configure(s, { text: 'أسماء سور القرآن' }).ok, true);
  assert.equal(M.configure(s, { seconds: 90 }).ok, true);
  assert.equal(M.configure(s, { points: 10 }).ok, true);

  assert.equal(s.round.text, 'أسماء سور القرآن');
  assert.equal(s.round.seconds, 90);
  assert.equal(s.round.points, 10);
  assert.equal(s.round.timer.leftMs, 90_000, 'الرصيد يتبع الإعداد قبل البدء');
});

test('القيم تُحصر في حدودها بدل أن تُرفض', () => {
  const s = session();
  M.configure(s, { seconds: 5000 });
  assert.equal(s.round.seconds, M.MAX_SECONDS);
  M.configure(s, { seconds: 1 });
  assert.equal(s.round.seconds, M.MIN_SECONDS);
  M.configure(s, { points: 0 });
  assert.equal(s.round.points, 1);
  assert.equal(M.configure(s, { seconds: 'كثير' }).ok, false);
});

test('رقعةٌ فيها حقلٌ فاسد تُرفض كلُّها ولا تُطبَّق نصفها', () => {
  const s = session();
  M.configure(s, { text: 'الأصل', seconds: 60, points: 5 });

  const r = M.configure(s, { text: 'الجديد', seconds: 'كثير', points: 9 });
  assert.equal(r.ok, false, 'رُفضت');
  // المناولة لا تبثّ عند الرفض، فتعديلٌ جزئيٌّ باقٍ في الخادم لا يراه الخصم أبداً
  assert.equal(s.round.text, 'الأصل', 'ولم يُغيَّر الشرط');
  assert.equal(s.round.points, 5, 'ولا النقاط');
  assert.equal(s.round.seconds, 60, 'ولا الوقت');
});

test('المزاد لا يُفتح بلا شرطٍ مكتوب', () => {
  const s = session();
  assert.equal(M.openBidding(s, 'a', 5).ok, false, 'بلا شرط');
  M.configure(s, { text: 'أسماء الخلفاء الراشدين' });
  assert.equal(M.openBidding(s, 'a', 5).ok, true);
  assert.equal(s.phase, 'bidding');
  assert.equal(s.round.bid, 5);
  assert.equal(s.round.turnId, 'b', 'الدور ينتقل للخصم');
});

test('المزايدة بالتناوب، وفوق آخر رقمٍ لا دونه', () => {
  const s = session();
  M.configure(s, { text: 'شرط' });
  M.openBidding(s, 'a', 5);

  assert.equal(M.raise(s, 'a', 9).ok, false, 'ليس دوره');
  assert.equal(M.raise(s, 'b', 5).ok, false, 'لا يساوي آخر رقم');
  assert.equal(M.raise(s, 'b', 3).ok, false, 'ولا دونه');

  assert.equal(M.raise(s, 'b', 8).ok, true);
  assert.equal(s.round.bid, 8);
  assert.equal(s.round.bidderId, 'b');
  assert.equal(s.round.turnId, 'a', 'ورجع الدور');
  assert.equal(s.round.bids.length, 2, 'وعدّاد الزيادات يرتفع');
});

test('«عليك هاتها» تُسلّم التحدي لصاحب آخر مزايدة', () => {
  const s = session();
  M.configure(s, { text: 'شرط' });
  M.openBidding(s, 'a', 5);
  M.raise(s, 'b', 8);

  assert.equal(M.handOver(s, 'b').ok, false, 'ليس دوره');
  assert.equal(M.handOver(s, 'a').ok, true);

  assert.equal(s.phase, 'challenge');
  assert.equal(s.round.challengerId, 'b', 'المتحدّي هو من زايد أخيراً');
  assert.equal(s.round.bid, 8, 'بالرقم الذي زايده');
  assert.equal(s.round.turnId, null);
});

test('المؤقّت يجري ويتوقف ويُضبط بحساب الوقت لا بانتظاره', () => {
  const s = atChallenge();
  const t0 = 1_000_000;

  assert.equal(M.timeLeft(s, t0), 60_000);
  M.timerStart(s, t0);
  assert.equal(M.timeLeft(s, t0 + 10_000), 50_000, 'عشر ثوانٍ مضت');

  M.timerPause(s, t0 + 10_000);
  assert.equal(M.timeLeft(s, t0 + 30_000), 50_000, 'موقوفٌ فلا ينقص');

  M.timerAdjust(s, 15, t0 + 30_000);
  assert.equal(M.timeLeft(s, t0 + 30_000), 65_000, 'زيدت خمس عشرة');

  M.timerStart(s, t0 + 30_000);
  M.timerAdjust(s, -5, t0 + 35_000);
  assert.equal(M.timeLeft(s, t0 + 35_000), 55_000, 'نقصت خمس وهو يجري');
  assert.equal(s.round.timer.running, true, 'ويبقى جارياً بعد التعديل');

  assert.equal(M.timeLeft(s, t0 + 200_000), 0, 'لا ينزل تحت الصفر');
});

test('المؤقّت المنتهي لا ينطلق حتى يُصفَّر', () => {
  const s = atChallenge();
  const t0 = 1_000_000;
  M.timerStart(s, t0);
  M.timerPause(s, t0 + 60_000);
  assert.equal(M.timeLeft(s, t0 + 60_000), 0);

  assert.equal(M.timerStart(s, t0 + 60_000).ok, false, 'لا ينطلق من صفر');
  assert.equal(M.timerReset(s, t0 + 60_000).ok, true);
  assert.equal(M.timeLeft(s, t0 + 60_000), 60_000);
  assert.equal(M.timerStart(s, t0 + 60_000).ok, true);
});

test('الإجابات يضيفها ويحذفها أيّ اللاعبَين', () => {
  const s = atChallenge();

  assert.equal(M.addAnswer(s, 'b', 'أبو بكر').ok, true);
  assert.equal(M.addAnswer(s, 'a', ' عمر  بن   الخطاب ').index, 1, 'والخصم أيضاً');
  assert.equal(s.round.answers[1].text, 'عمر بن الخطاب', 'تُنظَّف المسافات');
  assert.equal(M.addAnswer(s, 'b', '   ').ok, false, 'لا فارغة');

  // ختم النصّ يحرس من تزاحم ✕ بيد الاثنين: موضعٌ أزاحه حذفُ الخصم لا يُحذف بالخطأ
  assert.equal(M.removeAnswer(s, 0, 'عمر بن الخطاب').ok, false, 'ختمٌ لا يطابق الموضع');
  assert.equal(s.round.answers.length, 2, 'ولم تُحذف شارةٌ لم يقصدها أحد');

  assert.equal(M.removeAnswer(s, 0, 'أبو بكر').ok, true, 'يُحذف خطأ المايك');
  assert.equal(s.round.answers.length, 1);
  assert.equal(s.round.answers[0].text, 'عمر بن الخطاب');
  assert.equal(M.removeAnswer(s, 9).ok, false, 'موضع غير موجود');

  M.clearAnswers(s);
  assert.equal(s.round.answers.length, 0);
});

test('أجابها ← للمتحدّي، عجز ← لخصمه', () => {
  const win = atChallenge();
  M.judge(win, true);
  assert.equal(win.scores.b, 5, 'المتحدّي أخذها');
  assert.equal(win.scores.a, 0);
  assert.equal(win.phase, 'judged');

  const lose = atChallenge();
  M.judge(lose, false);
  assert.equal(lose.scores.a, 5, 'ومن سلّمها يأخذها إن عجز');
  assert.equal(lose.scores.b, 0);
});

test('الحكم يوقف العدّاد', () => {
  const s = atChallenge();
  const t0 = 1_000_000;
  M.timerStart(s, t0);
  M.judge(s, true, t0 + 20_000);

  assert.equal(s.round.timer.running, false);
  assert.equal(M.timeLeft(s, t0 + 90_000), 40_000, 'تجمّد على ما تبقّى');
});

test('النقاط المعدَّلة وسط التحدي هي التي تُحتسب', () => {
  const s = atChallenge();
  assert.equal(M.configure(s, { points: 12 }).ok, true, 'التعديل متاح أثناء التحدي');
  M.judge(s, true);
  assert.equal(s.scores.b, 12);
});

test('الشرط لا يُبدَّل بعد فتح المزاد', () => {
  const s = session();
  M.configure(s, { text: 'الأول' });
  M.openBidding(s, 'a', 4);
  assert.equal(M.configure(s, { text: 'الثاني' }).ok, false);
  assert.equal(s.round.text, 'الأول');
});

test('الجولة التالية نظيفة لكنها تحتفظ بالوقت والنقاط', () => {
  const s = atChallenge();
  M.configure(s, { seconds: 120, points: 9 });
  assert.equal(M.nextRound(s).ok, false, 'لا انتقال قبل الحكم');

  M.judge(s, true);
  assert.equal(M.nextRound(s).ok, true);

  assert.equal(s.roundNo, 2);
  assert.equal(s.phase, 'setup');
  assert.equal(s.round.text, '', 'شرطٌ جديد');
  assert.deepEqual(s.round.answers, []);
  assert.equal(s.round.bid, 0);
  assert.equal(s.round.seconds, 120, 'والوقت المضبوط باقٍ');
  assert.equal(s.round.points, 9);
  assert.equal(s.scores.b, 9, 'والرصيد محفوظ');
});

test('الجلسة تنتهي متى شاءا، والفائز صاحب الرصيد الأعلى', () => {
  const s = atChallenge();
  M.judge(s, true);
  M.nextRound(s);

  assert.equal(M.endSession(s).ok, true);
  assert.equal(s.status, 'over');
  assert.equal(s.winnerId, 'b');
  assert.equal(M.endSession(s).ok, false, 'لا تنتهي مرتين');
});

test('تعادل الرصيدين ينتهي بلا فائز', () => {
  const s = atChallenge();
  M.judge(s, true);          // ب +٥
  M.nextRound(s);
  M.configure(s, { text: 'شرط آخر' });
  M.openBidding(s, 'b', 3);
  M.raise(s, 'a', 6);
  M.handOver(s, 'b');        // أ هو المتحدّي
  M.judge(s, true);          // أ +٥
  M.endSession(s);

  assert.equal(s.scores.a, s.scores.b);
  assert.equal(s.winnerId, null);
});

test('اللقطة متماثلة للطرفين إلا «أنا» ودورُ المزايدة', () => {
  const s = session();
  M.configure(s, { text: 'شرط' });
  M.openBidding(s, 'a', 5);

  const va = M.viewFor(s, 'a', 1000);
  const vb = M.viewFor(s, 'b', 1000);

  assert.equal(va.round.text, vb.round.text, 'الشرط يراه الطرفان');
  assert.equal(va.round.bid, vb.round.bid);
  assert.equal(va.round.myTurn, false);
  assert.equal(vb.round.myTurn, true, 'والدور لصاحبه');
  assert.equal(va.me.id, 'a');
  assert.equal(vb.me.id, 'b');
});
