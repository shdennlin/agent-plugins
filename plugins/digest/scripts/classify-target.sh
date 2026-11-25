#!/bin/bash
# Explain Target Classifier
# Parses the raw argument text of /digest:explain, classifies the target, and prints one JSON
# object for the orchestrating command to consume. All deterministic work lives here.
#
# The raw argument text arrives on STDIN, never on the command line, so question text such as
# "why does a;b fail?" is data and is never parsed by a shell. Called from
# plugins/digest/commands/explain.md as:
#   "${CLAUDE_PLUGIN_ROOT}/scripts/classify-target.sh" <<'ARGS'
#   $ARGUMENTS
#   ARGS
#
# Kept compatible with macOS /bin/bash 3.2: no associative arrays, no empty-array expansion
# under set -u, no (( i++ )) as a statement.

set -euo pipefail

KINDS="file pr branch symbol question"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

show_help() {
  cat <<'EOF'
Usage: /digest:explain [target] [options]

Explain code or a change. State targets (path, symbol, question) produce a self-contained
HTML explainer; change targets (#PR, branch, current branch) produce a card in chat.

Targets:
  (no argument)         The current conversation's findings; else the current branch vs its
                        base; else nothing to explain
  <path>                A file or directory: role, flow, design history
  <symbol>              A function or class: its role in the whole flow
  <question>            A free-form how/why question (git archaeology)
  #<number>             A pull request (needs gh, logged in)
  <branch>              A local branch or remote-tracking branch, diffed against its base

Options:
  -f, --for <audience>  Tailor for an audience (manager, non-technical, "new teammate", ...)
      --teach           Short, read-only explanation in chat (cannot be combined with --html)
      --html            Write the HTML explainer for a change target as well
      --as <kind>       Force the reading of the target: file, pr, branch, symbol, question
  -h, --help            Show this help message

The first line of every run says how the target was read; use --as to force another reading.

Examples:
  /digest:explain                          # conversation findings, else the current branch
  /digest:explain src/auth/                # how does this module work?
  /digest:explain handleRetry              # role of a function
  /digest:explain "why is retry jittered?" # design rationale
  /digest:explain #42                      # summarize a pull request
  /digest:explain feat/auth --html         # branch summary as an HTML file
  /digest:explain main --as symbol         # read "main" as a symbol, not the branch
EOF
}

die() { echo "ERROR: $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# Tokenize: whitespace separates, "..." and '...' group, an unmatched quote consumes the
# rest of the text literally.
# ---------------------------------------------------------------------------

TOKENS=()
tokenize() {
  local s=$1 i=0 n=${#1} c q="" cur="" has=0
  while [ "$i" -lt "$n" ]; do
    c=${s:i:1}
    if [ -n "$q" ]; then
      if [ "$c" = "$q" ]; then q=""; else cur+=$c; fi
    elif [ "$c" = '"' ] || [ "$c" = "'" ]; then
      q=$c
      has=1
    elif [[ $c == [[:space:]] ]]; then
      if [ "$has" -eq 1 ]; then TOKENS+=("$cur"); cur=""; has=0; fi
    else
      cur+=$c
      has=1
    fi
    i=$((i + 1))
  done
  if [ "$has" -eq 1 ]; then TOKENS+=("$cur"); fi
}

tokenize "$(cat)"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

audience="developer"
teach=false
html=false
forced=""
REST=()

count=${#TOKENS[@]}
i=0
while [ "$i" -lt "$count" ]; do
  t=${TOKENS[$i]}
  case "$t" in
    -h|--help) show_help; exit 0 ;;
    -f|--for)
      i=$((i + 1)); [ "$i" -lt "$count" ] || die "$t needs an audience"
      audience=${TOKENS[$i]} ;;
    --teach) teach=true ;;
    --html) html=true ;;
    --as)
      i=$((i + 1)); [ "$i" -lt "$count" ] || die "--as needs a kind ($KINDS)"
      forced=${TOKENS[$i]}
      case " $KINDS " in *" $forced "*) ;; *) die "--as: unknown kind '$forced' (use: $KINDS)" ;; esac ;;
    *) REST+=("$t") ;;
  esac
  i=$((i + 1))
done

if [ "$teach" = true ] && [ "$html" = true ]; then
  die "--teach and --html cannot be combined"
fi

target=""
if [ "${#REST[@]}" -gt 0 ]; then target="${REST[*]}"; fi

# ---------------------------------------------------------------------------
# Repository facts
# ---------------------------------------------------------------------------

root="${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root"

branch="$(git symbolic-ref --short -q HEAD 2>/dev/null || true)"

base=""
if git show-ref --verify --quiet refs/heads/develop; then
  base="develop"
elif git show-ref --verify --quiet refs/heads/main; then
  base="main"
fi

on_base=false
if [ -n "$branch" ] && [ "$branch" = "$base" ]; then on_base=true; fi

diff_empty=true
if [ -n "$base" ]; then
  if git diff --quiet "$base...HEAD" 2>/dev/null; then diff_empty=true; else diff_empty=false; fi
fi

gh_ok=false
if command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then gh_ok=true; fi

# ---------------------------------------------------------------------------
# Classification: path > #N > branch > symbol > question
# ---------------------------------------------------------------------------

is_branch() {
  git show-ref --verify --quiet "refs/heads/$1" || git show-ref --verify --quiet "refs/remotes/$1"
}

kind=""
if [ -z "$target" ]; then
  [ -z "$forced" ] || die "--as $forced needs a target"
  kind="empty"
elif [ -n "$forced" ]; then
  kind=$forced
  case "$kind" in
    file)   [ -e "$target" ] || die "--as file: '$target' does not exist" ;;
    pr)     [[ $target =~ ^#?[0-9]+$ ]] || die "--as pr: '$target' is not a PR number (#42)"
            target="#${target#\#}" ;;
    branch) is_branch "$target" || die "--as branch: '$target' is not a local or remote-tracking branch" ;;
  esac
elif [ -e "$target" ]; then
  kind="file"
elif [[ $target =~ ^#[0-9]+$ ]]; then
  kind="pr"
elif is_branch "$target"; then
  kind="branch"
elif [[ $target =~ ^[A-Za-z0-9_][A-Za-z0-9_.:]*$ ]]; then
  kind="symbol"
else
  kind="question"
fi

# ---------------------------------------------------------------------------
# Slug
# ---------------------------------------------------------------------------

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Replace anything outside [A-Za-z0-9._-] with '-', squeeze and trim dashes.
sanitize() { printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/-+/-/g; s/^-//; s/-$//'; }

# camelCase -> kebab-case, then sanitize and lowercase.
kebab() { lower "$(sanitize "$(printf '%s' "$1" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g')")"; }

slug=""
case "$kind" in
  empty)    slug="" ;;
  pr)       slug="pr-${target#\#}" ;;
  branch)   slug="$(sanitize "$target")" ;;
  file)     b="$(basename "$target")"; b2="${b%.*}"; slug="$(sanitize "${b2:-$b}")" ;;
  symbol)   slug="$(kebab "$target")" ;;
  question)
    words=""; n=0
    for w in $target; do
      [ "$n" -lt 5 ] || break
      words="$words $w"; n=$((n + 1))
    done
    slug="$(lower "$(sanitize "$words")")" ;;
esac
# A target with no ASCII letters or digits (e.g. an all-Chinese question) still needs a slug.
if [ "$kind" != "empty" ] && [ -z "$slug" ]; then slug="topic"; fi

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

resolved_line=""
if [ "$kind" != "empty" ]; then
  if [ -n "$forced" ]; then
    resolved_line="解析為:$kind $target  (已用 --as $forced 指定)"
  else
    resolved_line="解析為:$kind $target  (用 --as <kind> 強制其他解讀)"
  fi
fi

jq -n \
  --arg audience "$audience" \
  --argjson teach "$teach" \
  --argjson html "$html" \
  --arg forced "$forced" \
  --arg target "$target" \
  --arg kind "$kind" \
  --arg slug "$slug" \
  --arg resolved_line "$resolved_line" \
  --arg branch "$branch" \
  --arg base "$base" \
  --argjson on_base "$on_base" \
  --argjson diff_empty "$diff_empty" \
  --argjson gh_ok "$gh_ok" \
  '{help: false, audience: $audience, teach: $teach, html: $html, forced: $forced,
    target: $target, kind: $kind, slug: $slug, resolved_line: $resolved_line,
    branch: $branch, base: $base, on_base: $on_base, diff_empty: $diff_empty, gh_ok: $gh_ok}'
