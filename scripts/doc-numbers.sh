#!/usr/bin/env bash
#
# Reports, per numbered sequence in a spec document, the next number to use and
# which numbers are retired (defined once, since deleted).
#
# CLAUDE.md's rule is that a new item takes `highest-ever-used + 1`, never
# `highest-currently-live + 1`. Those two differ precisely when the highest item
# is the one that got deleted, and reusing its number silently repoints every
# existing citation: a commit message closing `OQ-8 (category)` came to read as
# though it closed an unrelated question about public profiles. The answer lives
# in git history, not the working tree, so this walks every committed revision.
#
# Only the PRDs are checked by default. The spec documents define no FR/NFR/AC/
# OQ of their own -- they cite the PRDs' -- and their own numbered items are
# Decisions-table rows, written as bare table cells that no pattern can pick out
# from surrounding prose. Pass a spec explicitly if you want it anyway.
#
#   scripts/doc-numbers.sh [file...]      (default: docs/specs/prd-*.md)
#
# Paths are resolved from the repository root, not the current directory.

set -euo pipefail

# Hyphenated (FR-1) and unhyphenated (MI1) sequences both exist. They are not
# going to be normalized: renumbering to tidy the format would repoint exactly
# the citations this script exists to protect.
IDENT='(FR|NFR|AC|OQ)-[0-9]+|(MI|NG|R)[0-9]+'

# A *definition* opens a list item or a table row -- `- **FR-8 — ...`,
# `- AC-12. ...`, `- NG5. ...`, `| MI3 | Missing ...`. A mid-line `(from OQ-6)`
# or `see FR-9` is a reference, and must not count as live, or a deleted item
# looks alive for as long as anything still points at it.
defs() { grep -oE "^[[:space:]]*[-|][[:space:]|]*\**($IDENT)" "${1:--}" || true; }
refs() { grep -oE "$IDENT" "${1:--}" || true; }

# "<tag> <PREFIX> <NUMBER>" lines, so one awk pass can group on the sequence.
tagged() { grep -oE "$IDENT" | sed -E "s/^([A-Z]+)-?([0-9]+)$/$1 \\1 \\2/" || true; }

cd "$(git rev-parse --show-toplevel)"

files=("$@")
[[ ${#files[@]} -eq 0 ]] && files=(docs/specs/prd-*.md)

for f in "${files[@]}"; do
    rel=$(git ls-files --full-name -- "$f" 2>/dev/null || true)
    if [[ -z $rel ]]; then
        echo "skipping $f (not tracked by git)" >&2
        continue
    fi

    # `while read`, not `for c in $(...)`: zsh does not word-split an unquoted
    # parameter, so the for-loop form hands every hash to a single git show and
    # reports that nothing was ever defined -- which is the answer that lets a
    # colliding number through.
    revs=$(git log --all --format=%H -- "$rel")
    history() {
        printf '%s\n' "$revs" | while IFS= read -r c; do
            [[ -n $c ]] && git show "$c:$rel" 2>/dev/null
        done
    }

    echo "$rel"
    {
        # Order matters: live before ever, so the retired check can consult it.
        defs "$rel" | tagged live
        { history | defs; defs "$rel"; } | tagged ever
        # Every number referenced anywhere, ever. If this outruns the
        # definitions found, the definition pattern has missed a formatting
        # variant -- and silently under-reporting the max is the dangerous
        # direction, so say so rather than hand back a colliding number.
        { history | refs; refs "$rel"; } | tagged seen
    } | awk '
        $1 == "live" { islive[$2 "-" $3] = 1; next }
        $1 == "ever" {
            if ($3 + 0 > mx[$2]) mx[$2] = $3 + 0
            if (!(($2 "-" $3) in islive) && !(($2 "-" $3) in dead)) {
                dead[$2 "-" $3] = 1
                gone[$2] = ($2 in gone) ? gone[$2] "," $3 : $3    # ordered by first appearance in history
            }
            next
        }
        { if ($3 + 0 > sn[$2]) sn[$2] = $3 + 0; seq[$2] = 1 }
        END {
            for (p in seq) {
                # The max of definitions AND bare references. A reference with no
                # definition behind it means the definition pattern missed a
                # format, and under-reporting the max is the one direction that
                # hands back a colliding number -- so take the larger either way.
                top = (sn[p] > mx[p]) ? sn[p] : mx[p]
                line = sprintf("  %-4s next: %s-%d", p, p, top + 1)
                if (p in gone) line = line sprintf("   retired: %s", gone[p])
                if (sn[p] > mx[p])
                    line = line sprintf("   [%s-%d is referenced but never defined here -- retired list is incomplete]", p, sn[p])
                print line
            }
        }
    ' | sort
done
