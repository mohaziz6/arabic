#!/bin/bash
# يهيّئ جلسات ديوان التحدي: سيرفر معاينة ثابت + متصفح جاهز للقطات.
# المشروع بلا اعتماديات ولا نظام بناء، فلا يوجد ما يُثبَّت.
set -euo pipefail

# محلياً لا نحتاج شيئاً — المطوّر يفتح index.html بنفسه.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PORT=8000
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# متصفح Chromium مثبّت مسبقاً في بيئة الويب — نمرّر مساره لسكربتات Playwright.
if [ -x /opt/pw-browsers/chromium ]; then
  {
    echo 'export PLAYWRIGHT_BROWSERS_PATH="/opt/pw-browsers"'
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'
    echo 'export CHROMIUM_PATH="/opt/pw-browsers/chromium"'
  } >> "${CLAUDE_ENV_FILE:-/dev/null}"
fi

echo "export DIWAN_PREVIEW_URL=\"http://localhost:$PORT\"" >> "${CLAUDE_ENV_FILE:-/dev/null}"

# سيرفر المعاينة — يُشغَّل مرة واحدة فقط (idempotent).
if curl -sf -o /dev/null "http://localhost:$PORT/index.html" 2>/dev/null; then
  echo "سيرفر المعاينة يعمل مسبقاً على المنفذ $PORT"
  exit 0
fi

cd "$ROOT"
nohup python3 -m http.server "$PORT" > "$ROOT/.claude/preview.log" 2>&1 &

for _ in $(seq 1 20); do
  if curl -sf -o /dev/null "http://localhost:$PORT/index.html" 2>/dev/null; then
    echo "سيرفر المعاينة جاهز: http://localhost:$PORT"
    exit 0
  fi
  sleep 0.25
done

echo "تعذّر تشغيل سيرفر المعاينة على المنفذ $PORT — راجع .claude/preview.log" >&2
exit 0
