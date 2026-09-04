#!/bin/bash
# يمنع انحراف التوثيق عن الكود.
#
# CLAUDE.md هو ذاكرة المشروع الوحيدة بين الجلسات: جلسة جديدة تقرؤه ثم تكمل.
# فإن تغيّر الكود ولم يتغيّر معه، ضاع على الجلسة القادمة ما تعلّمناه هنا.
#
# يعمل عند Stop (انتهاء دور Claude):
#   • تعديلات كودٍ غير مُوثَّقة في الشجرة العاملة → يمنع الإنهاء **مرة واحدة**
#     في الجلسة ويطلب تشغيل /sync-docs. مرة واحدة فقط كي لا تصير حلقة.
#   • آخر التزامٍ للكود أحدث من آخر التزامٍ لـ CLAUDE.md → تنبيه للمستخدم بلا منع.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null || echo '{}')
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
STAMP="$ROOT/.claude/.docs-nudged"

# ما يُعدّ كوداً، وما يُعدّ توثيقاً له
SOURCES=(server assets index.html package.json)
DOCS=(CLAUDE.md README.md docs)

dirty_src=$(git status --porcelain -- "${SOURCES[@]}" 2>/dev/null)
dirty_docs=$(git status --porcelain -- "${DOCS[@]}" 2>/dev/null)

emit() {  # $1 = systemMessage، $2 = تعليمات للنموذج (فارغة = بلا منع)
  if [ -n "${2:-}" ]; then
    jq -cn --arg m "$1" --arg r "$2" \
      '{systemMessage:$m, decision:"block", reason:$r}'
  else
    jq -cn --arg m "$1" '{systemMessage:$m}'
  fi
  exit 0
}

# (١) كودٌ معدَّل بلا توثيق معدَّل — يُمنع الإنهاء مرة واحدة في الجلسة
if [ -n "$dirty_src" ] && [ -z "$dirty_docs" ]; then
  [ "$(cat "$STAMP" 2>/dev/null)" = "$SESSION" ] && exit 0
  printf '%s' "$SESSION" > "$STAMP"
  files=$(printf '%s\n' "$dirty_src" | awk '{print $NF}' | head -8 | tr '\n' ' ')
  emit "تعديلات كود بلا تحديث توثيق — طُلب من Claude تشغيل /sync-docs" \
"تغيّر كودٌ ولم يتغيّر معه أي ملف توثيق: $files

شغّل /sync-docs الآن قبل إنهاء الدور — حدّث CLAUDE.md (وREADME.md وdocs/ إن لزم)
بما تعلّمناه في هذه الجلسة: القرارات وأسبابها، ما جُرِّب وفشل، الأخطاء التي أُصلحت،
عدد الاختبارات الفعلي، والبنود المفتوحة. هذا التذكير يُطلق مرة واحدة في الجلسة؛
إن كان التغيير لا يستحق توثيقاً (تجربة مؤقتة، ملف عابر) فقل ذلك واختم دورك."
fi

# (٢) تاريخ الالتزامات: كودٌ التُزم بعد آخر تحديث لـ CLAUDE.md — تنبيه بلا منع
if [ -z "$dirty_src" ] && [ -z "$dirty_docs" ]; then
  src_t=$(git log -1 --format=%ct -- "${SOURCES[@]}" 2>/dev/null)
  doc_t=$(git log -1 --format=%ct -- CLAUDE.md 2>/dev/null)
  if [ -n "${src_t:-}" ] && [ "${src_t:-0}" -gt "${doc_t:-0}" ]; then
    emit "آخر التزام للكود أحدث من آخر تحديث لـ CLAUDE.md — شغّل /sync-docs عند الحاجة" ""
  fi
fi

exit 0
