# Ralph Loop Plugin (Session-Isolated Fork)

Forked from [Anthropic's ralph-loop plugin](https://github.com/anthropics/claude-code) with a critical **cross-session isolation bug fix**.

## Why This Fork?

The official ralph-loop plugin has a bug where the Stop hook **hijacks all Claude Code sessions** in the same project directory, not just the session that started the loop.

### The Bug

- **Issue**: [anthropics/claude-code#15047](https://github.com/anthropics/claude-code/issues/15047)
- **Best fix PR**: [anthropics/claude-code#15853](https://github.com/anthropics/claude-code/pull/15853) (open, not merged)
- **Other related PRs**: [#26077](https://github.com/anthropics/claude-code/pull/26077), [#30626](https://github.com/anthropics/claude-code/pull/30626)

**Root cause**: The setup script writes `session_id: ${CLAUDE_CODE_SESSION_ID:-}` to a shared state file. When `CLAUDE_CODE_SESSION_ID` is empty, the session isolation guard in the stop hook is bypassed (`-n ""` evaluates to false), causing the hook to block exit in ALL sessions.

### The Fix (based on PR #15853)

1. **`SessionStart` hook** captures `session_id` from hook input and persists it as `CLAUDE_SESSION_ID` via `CLAUDE_ENV_FILE`
2. **Per-session state files** stored at `<plugin-root>/state/{session_id}.md` instead of the shared `.claude/ralph-loop.local.md`
3. **Fail fast** if `CLAUDE_SESSION_ID` is not available — refuses to start rather than silently breaking isolation
4. **Stop hook** extracts `session_id` from its input and only looks for the matching state file

---

## What is Ralph Loop?

Implementation of the Ralph Wiggum technique for iterative, self-referential AI development loops in Claude Code.

Ralph Loop is a development methodology based on continuous AI agent loops. As Geoffrey Huntley describes it: **"Ralph is a Bash loop"** - a simple `while true` that repeatedly feeds an AI agent a prompt file, allowing it to iteratively improve its work until completion.

This technique is inspired by the Ralph Wiggum coding technique (named after the character from The Simpsons), embodying the philosophy of persistent iteration despite setbacks.

### Core Concept

This plugin implements Ralph using a **Stop hook** that intercepts Claude's exit attempts:

```bash
# You run ONCE:
/ralph-loop "Your task description" --completion-promise "DONE"

# Then Claude Code automatically:
# 1. Works on the task
# 2. Tries to exit
# 3. Stop hook blocks exit
# 4. Stop hook feeds the SAME prompt back
# 5. Repeat until completion
```

The loop happens **inside your current session** - you don't need external bash loops. The Stop hook in `hooks/stop-hook.sh` creates the self-referential feedback loop by blocking normal session exit.

This creates a **self-referential feedback loop** where:
- The prompt never changes between iterations
- Claude's previous work persists in files
- Each iteration sees modified files and git history
- Claude autonomously improves by reading its own past work in files

## Quick Start

```bash
/ralph-loop "Build a REST API for todos. Requirements: CRUD operations, input validation, tests. Output <promise>COMPLETE</promise> when done." --completion-promise "COMPLETE" --max-iterations 50
```

Claude will:
- Implement the API iteratively
- Run tests and see failures
- Fix bugs based on test output
- Iterate until all requirements met
- Output the completion promise when done

## Commands

### /ralph-loop

Start a Ralph loop in your current session.

**Usage:**
```bash
/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"
```

**Options:**
- `--max-iterations <n>` - Stop after N iterations (default: unlimited)
- `--completion-promise <text>` - Phrase that signals completion

### /cancel-ralph

Cancel the active Ralph loop.

**Usage:**
```bash
/cancel-ralph
```

## Prompt Writing Best Practices

### 1. Clear Completion Criteria

❌ Bad: "Build a todo API and make it good."

✅ Good:
```markdown
Build a REST API for todos.

When complete:
- All CRUD endpoints working
- Input validation in place
- Tests passing (coverage > 80%)
- README with API docs
- Output: <promise>COMPLETE</promise>
```

### 2. Incremental Goals

❌ Bad: "Create a complete e-commerce platform."

✅ Good:
```markdown
Phase 1: User authentication (JWT, tests)
Phase 2: Product catalog (list/search, tests)
Phase 3: Shopping cart (add/remove, tests)

Output <promise>COMPLETE</promise> when all phases done.
```

### 3. Self-Correction

❌ Bad: "Write code for feature X."

✅ Good:
```markdown
Implement feature X following TDD:
1. Write failing tests
2. Implement feature
3. Run tests
4. If any fail, debug and fix
5. Refactor if needed
6. Repeat until all green
7. Output: <promise>COMPLETE</promise>
```

### 4. Escape Hatches

Always use `--max-iterations` as a safety net to prevent infinite loops on impossible tasks:

```bash
# Recommended: Always set a reasonable iteration limit
/ralph-loop "Try to implement feature X" --max-iterations 20

# In your prompt, include what to do if stuck:
# "After 15 iterations, if not complete:
#  - Document what's blocking progress
#  - List what was attempted
#  - Suggest alternative approaches"
```

**Note**: The `--completion-promise` uses exact string matching, so you cannot use it for multiple completion conditions (like "SUCCESS" vs "BLOCKED"). Always rely on `--max-iterations` as your primary safety mechanism.

## Philosophy

### 1. Iteration > Perfection
Don't aim for perfect on first try. Let the loop refine the work.

### 2. Failures Are Data
"Deterministically bad" means failures are predictable and informative. Use them to tune prompts.

### 3. Operator Skill Matters
Success depends on writing good prompts, not just having a good model.

### 4. Persistence Wins
Keep trying until success. The loop handles retry logic automatically.

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement (e.g., getting tests to pass)
- Greenfield projects where you can walk away
- Tasks with automatic verification (tests, linters)

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Production debugging (use targeted debugging instead)

## Real-World Results

- Successfully generated 6 repositories overnight in Y Combinator hackathon testing
- One $50k contract completed for $297 in API costs
- Created entire programming language ("cursed") over 3 months using this approach

## Windows Compatibility

The stop hook uses a bash script that requires Git for Windows to run properly.

**Issue**: On Windows, the `bash` command may resolve to WSL bash (often misconfigured) instead of Git Bash, causing the hook to fail with errors like:
- `wsl: Unknown key 'automount.crossDistro'`
- `execvpe(/bin/bash) failed: No such file or directory`

**Workaround**: Edit the cached plugin's `hooks/hooks.json` to use Git Bash explicitly:

```json
"command": "\"C:/Program Files/Git/bin/bash.exe\" ${CLAUDE_PLUGIN_ROOT}/hooks/stop-hook.sh"
```

**Note**: Use `Git/bin/bash.exe` (the wrapper with proper PATH), not `Git/usr/bin/bash.exe` (raw MinGW bash without utilities in PATH).

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator

## For Help

Run `/help` in Claude Code for detailed command reference and examples.
