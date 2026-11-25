#!/usr/bin/env bash
# Consistency checks for the explain command, skill, agents and README: the few statements that
# must agree across files and that a prompt edit can silently break. Text checks only; they do
# not run any model.
#
#   bash plugins/digest/tests/explain-docs.test.sh
set -euo pipefail

D="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="$D/commands/explain.md"
SKILL="$D/skills/explain/SKILL.md"
AGENT="$D/agents/explain-agent.md"
CODEX="$D/skills/explain/explain-agent.md"
README="$D/README.md"
SCRIPT="$D/scripts/classify-target.sh"

fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }

# 1. The heredoc that feeds the script uses a terminator no user text will contain: a bare ARGS
#    line in a multi-line argument would otherwise end it early and run the rest in the shell.
grep -n "^ARGS$\|<<'ARGS'" "$CMD" "$SCRIPT" && fail "bare ARGS heredoc terminator still present"
grep -q "<<'DIGEST_EXPLAIN_ARGS_9f3a'" "$CMD" || fail "command must use the unique heredoc terminator"

# 2. --html replaces the card with a conclusion and the file path; nothing may say it is "also"/"as well".
grep -n -i -E -- '--html.*(also|as well|too)' "$CMD" "$SKILL" "$README" "$SCRIPT" \
  && fail "--html is described as additive, but it replaces the card"

# 3. The PR number handed to gh has no '#': in a shell, '#42' starts a comment and gh would show the
#    current branch's PR instead.
for f in "$AGENT" "$CODEX"; do
  grep -q 'without the `#`' "$f" || fail "$f must say the gh PR number has no #"
done

# 4. Card mode writes no file, so the Claude agent's Behavior must not write the HTML unconditionally.
grep -q 'When Output mode is `html`, write to' "$AGENT" || fail "agent Behavior must scope the file write to html mode"

# 5. The command stops, with a message, when a branch target has nothing to compare.
grep -q 'has no changes against' "$CMD" || fail "command needs the no-changes stop for a branch target"
grep -q 'No base branch' "$CMD" || fail "command needs the no-base stop for a branch target"

# 6. The migration note admits that tags, short hashes and HEAD~n are no longer branches.
grep -q -- '--as branch' "$README" || fail "README migration note must mention --as branch"
grep -q -- '-e` / `--export' "$README" || grep -q -- '`-e`' "$README" || fail "README must mention the -e error"

echo "ok: explain-docs"
