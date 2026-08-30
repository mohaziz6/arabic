/**
 * التقاط الصوت — واجهة صغيرة خلفها Web Speech API.
 *
 * التنفيذ الحالي مجاني وبلا خادم. إن خذلتنا الدقة على اللهجة النجدية،
 * يُبدَّل جسم startListening بمزوّد آخر ولا يتغيّر شيء في بقية اللعبة.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = () => Boolean(SR);

/**
 * يبدأ الاستماع. onUpdate يُنادى بالنص الجاري (نهائي + مؤقت) مع كل تحديث.
 * يُرجع كائناً فيه stop() يُعيد النص النهائي.
 */
export function startListening({ onUpdate, onError } = {}) {
  if (!SR) {
    onError?.('متصفحك لا يدعم التقاط الصوت — استخدم Chrome أو Edge، أو اكتب مرافعتك.');
    return null;
  }

  const rec = new SR();
  rec.lang = 'ar-SA';
  rec.continuous = true;
  rec.interimResults = true;

  let settled = '';
  let stopped = false;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) settled += chunk + ' ';
      else interim += chunk;
    }
    onUpdate?.((settled + interim).trim(), settled.trim());
  };

  rec.onerror = (e) => {
    // no-speech و aborted حالات عادية لا أخطاء تُعرض للاعب
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    onError?.(e.error === 'not-allowed'
      ? 'رُفض إذن المايكروفون — اسمح به من إعدادات المتصفح.'
      : `تعذّر الالتقاط: ${e.error}`);
  };

  // المتصفح يوقف الالتقاط تلقائياً بعد صمت؛ نعيد تشغيله ما دمنا لم نوقفه
  rec.onend = () => { if (!stopped) { try { rec.start(); } catch { /* سباق تشغيل */ } } };

  try { rec.start(); } catch { onError?.('تعذّر بدء الالتقاط.'); return null; }

  return {
    stop() {
      stopped = true;
      try { rec.stop(); } catch { /* متوقف أصلاً */ }
      return settled.trim();
    },
  };
}

/** ينطق نصاً بصوت القاضي. */
export function speak(text) {
  if (!window.speechSynthesis || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ar-SA';
  u.rate = 0.92;
  u.pitch = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
