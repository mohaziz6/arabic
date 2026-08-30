/**
 * تهيئة التشغيل: قراءة المفتاح من ملف، وشهادة HTTPS محلية، وعناوين الدخول.
 *
 * سبب HTTPS: المتصفحات تمنع المايكروفون إلا على localhost أو https.
 * فبلا شهادة، من يدخل من جواله يلعب بالكتابة فقط.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** يقرأ .env إن وُجد — ولا يدهس متغيّراً مضبوطاً في البيئة. */
export function loadEnv(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return false;

  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}

/** عنوان الجهاز على الشبكة المحلية، ليدخل صاحبك من جواله. */
export function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

/**
 * شهادة موقّعة ذاتياً، تُولَّد مرة وتُحفظ في .cert/ .
 * المتصفح سيحذّر منها — وهذا متوقّع لشهادة محلية، يُتجاوز بـ «متابعة».
 */
export async function ensureCert(root) {
  const dir = path.join(root, '.cert');
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  }

  const { generate } = await import('selfsigned');
  const lan = lanAddress();
  const alts = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...(lan ? [{ type: 7, ip: lan }] : []),
  ];

  const pems = await generate(
    [{ name: 'commonName', value: lan ?? 'localhost' }],
    { days: 825, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: alts }] },
  );

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  return { cert: pems.cert, key: pems.private };
}
