#!/usr/bin/env bash
#
# Fails on markdown that Cursor's preview silently truncates.
#
# The trigger is a *loose* indented continuation: a blank line, then a block
# indented four or more spaces inside a list item. Cursor drops everything from
# that point to the end of the document, while GitHub renders it correctly --
# so nothing looks wrong unless you read the file in Cursor.
#
# A *tight* nested list (no blank line before it) is fine: architecture.md
# carries 64 of them and renders in full. Only the loose form breaks.
#
# Bisected to a single line: prd-browse-and-track.md rendered through line 99
# and died at line 102, whose only content was FR-3's indented `**Defaults.**`
# paragraph. Moving that one line to column 0 fixed it; changing its emphasis
# did not. Every other suspect was cleared -- bare `<`, line length, the table
# and its cells, nested bullets, tables after lists, and document size.
#
# Do not "fix" a finding by re-indenting to two spaces: Prettier normalises
# continuation content back to four, which is the broken form, so `yarn format`
# would silently undo it. De-indent the block to column 0 instead.
#
#   scripts/doc-render-check.sh [file...]      (default: all tracked .md)

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

files=("$@")
if [[ ${#files[@]} -eq 0 ]]; then
    while IFS= read -r f; do files+=("$f"); done < <(git ls-files '*.md')
fi

status=0
for f in "${files[@]}"; do
    [[ -f $f ]] || continue
    out=$(awk '
        /^```/          { fenced = !fenced; next }
        fenced          { prev_blank = 0; next }
        /^[[:space:]]*$/ { prev_blank = 1; next }
        /^ {4,}[^[:space:]]/ {
            if (prev_blank) printf "  %s:%d: %s\n", FILENAME, FNR, substr($0, 1, 90)
            prev_blank = 0
            next
        }
                        { prev_blank = 0 }
    ' "$f")
    if [[ -n $out ]]; then
        echo "$f: loose indented continuation(s) - Cursor will truncate the page here"
        echo "$out"
        status=1
    fi
done

if [[ $status -eq 0 ]]; then
    echo "No loose indented continuations found."
fi
exit $status
