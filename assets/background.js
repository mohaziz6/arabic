/**
 * خلفية "المعلقات" — صحف تنجرف ببطء، تبتعد عن مؤشر الماوس،
 * وتتطاير دفعةً واحدة عند الأحداث المهمة عبر Diwan.burst(x, y).
 */
(function () {
  // طبقتان: الانجراف الهادئ خلف المحتوى، والانفجار فوقه ليكون مرئياً.
  const bgCanvas = document.getElementById('bg');
  const fgCanvas = document.getElementById('fg');
  if (!bgCanvas || !fgCanvas) return;

  const bgCtx = bgCanvas.getContext('2d');
  const fgCtx = fgCanvas.getContext('2d');
  let ctx = bgCtx;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1;
  const sheets = [];
  const mouse = { x: -9999, y: -9999 };

  const AMBIENT = 16;      // عدد الصحف الدائمة
  const REPEL_RADIUS = 170;

  const rand = (a, b) => a + Math.random() * (b - a);

  function makeSheet(opts = {}) {
    const w = opts.w ?? rand(34, 78);
    return {
      x: opts.x ?? rand(0, W),
      y: opts.y ?? rand(0, H),
      w,
      h: w * rand(1.2, 1.5),
      rot: rand(-0.5, 0.5),
      spin: rand(-0.004, 0.004),
      vx: opts.vx ?? rand(-0.16, 0.16),
      vy: opts.vy ?? rand(-0.28, -0.06),
      alpha: opts.alpha ?? rand(0.3, 0.62),
      // أطوال الأسطر تُحسب مرة واحدة — حسابها داخل الرسم يجعلها ترتجف كل إطار
      lineLens: Array.from({ length: Math.round(rand(3, 6)) }, () => rand(0.55, 1)),
      temp: opts.temp ?? false,   // صحف الانفجار تختفي بعد أن تهدأ
      life: 1,
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = bgCanvas.clientWidth;
    H = bgCanvas.clientHeight;
    for (const [c, cx] of [[bgCanvas, bgCtx], [fgCanvas, fgCtx]]) {
      c.width = W * dpr;
      c.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSheet(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = s.alpha * s.life;

    // ظل دافئ خفيف
    ctx.shadowColor = 'rgba(90, 72, 48, 0.16)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;

    ctx.fillStyle = '#FFFDF7';
    roundRect(-s.w / 2, -s.h / 2, s.w, s.h, 3);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(201, 183, 150, 0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // أسطر كتابة موحية بالبيت الشعري
    ctx.strokeStyle = 'rgba(70, 58, 44, 0.17)';
    ctx.lineWidth = 1.1;
    const pad = s.w * 0.16;
    const step = (s.h - pad * 2) / (s.lineLens.length + 1);
    s.lineLens.forEach((frac, i) => {
      const y = -s.h / 2 + pad + step * (i + 1);
      const len = (s.w - pad * 2) * frac;
      ctx.beginPath();
      ctx.moveTo(-s.w / 2 + pad, y);
      ctx.lineTo(-s.w / 2 + pad + len, y);
      ctx.stroke();
    });

    ctx.restore();
  }

  function step() {
    bgCtx.clearRect(0, 0, W, H);
    fgCtx.clearRect(0, 0, W, H);

    for (let i = sheets.length - 1; i >= 0; i--) {
      const s = sheets[i];

      // نفور من مؤشر الماوس — كأن الهواء يدفعها
      const dx = s.x - mouse.x;
      const dy = s.y - mouse.y;
      const dist = Math.hypot(dx, dy);
      if (dist < REPEL_RADIUS && dist > 0.01) {
        const push = (1 - dist / REPEL_RADIUS) * 0.55;
        s.vx += (dx / dist) * push;
        s.vy += (dy / dist) * push;
        s.spin += push * 0.004;
      }

      s.x += s.vx;
      s.y += s.vy;
      s.rot += s.spin;

      // احتكاك يعيدها لانجرافها الهادئ
      s.vx *= 0.965;
      s.vy *= 0.965;
      s.spin *= 0.97;

      if (s.temp) {
        s.life -= 0.009;
        if (s.life <= 0) { sheets.splice(i, 1); continue; }
      } else {
        // انجراف دائم لأعلى، وتلتفّ حول الشاشة
        s.vy += (-0.14 - s.vy) * 0.004;
        const m = s.h;
        if (s.y < -m) { s.y = H + m; s.x = rand(0, W); }
        if (s.x < -m) s.x = W + m;
        if (s.x > W + m) s.x = -m;
      }

      ctx = s.temp ? fgCtx : bgCtx;   // الصحف المؤقتة تُرسم فوق المحتوى
      drawSheet(s);
    }

    requestAnimationFrame(step);
  }

  /** انفجار صحف من نقطة — يُستدعى عند الأحداث المهمة. */
  function burst(x, y, count = 14) {
    if (reduced) return;
    const cx = x ?? W / 2;
    const cy = y ?? H / 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + rand(-0.3, 0.3);
      const speed = rand(3.5, 9);
      sheets.push(makeSheet({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: rand(0.5, 0.85),
        temp: true,
      }));
    }
  }

  window.Diwan = window.Diwan || {};
  window.Diwan.burst = burst;

  function drawStatic() {
    ctx = bgCtx;
    bgCtx.clearRect(0, 0, W, H);
    sheets.forEach(drawSheet);
  }

  resize();

  for (let i = 0; i < AMBIENT; i++) sheets.push(makeSheet());

  if (reduced) {
    // لقطة ساكنة لمن يفضّل تقليل الحركة — تُعاد عند تغيير الحجم
    // لأن ضبط canvas.width يمسح اللوح.
    window.addEventListener('resize', () => { resize(); drawStatic(); });
    drawStatic();
    return;
  }

  window.addEventListener('resize', resize);

  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });

  requestAnimationFrame(step);
})();
