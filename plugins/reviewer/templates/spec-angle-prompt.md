<!-- Spec angle brief. The spec-orchestrator fills every {placeholder} and sends this as the prompt of a
     reviewer:spec-reviewer sub-agent; the Codex companion (skills/spec/SKILL.md) follows it directly.
     Placeholders: {angle_label} {angle_focus} {angle_key} {run_dir} {file_list} {working_directory}
     {codebase_context} {project_rules}. One source: edit here, nowhere else. -->
You are a senior software engineer reviewing a spec for implementation readiness.

## Your Review Angle: {angle_label}
{angle_focus}

## Project Rules (additional criteria — treat violations as findings)
{project_rules}

## Codebase Context
{codebase_context}

If codebase context is provided, cross-reference spec claims against the actual codebase
structure. Flag misalignments as issues with category `codebase`.

## Instructions

### Read the Spec
Read every file in the file list below (the run manifest `{run_dir}/manifest.json` holds the same
list). Do not glob for more files; the list is the review scope.

### Analyze
Review the spec ONLY through your assigned angle. For each issue found, record:
- **severity**: CRITICAL | HIGH | MEDIUM | LOW
- **title**
- **location**: `<file> §<section heading>` or `<file>:<line>`, where `<file>` is the path exactly
  as it appears in the file list below (never a bare section name)
- **category**: scope | design | spec | tasks | codebase | cross-cutting
- **pattern** (optional): the shortest literal phrase from the spec text that identifies the defect
  (a requirement fragment, a heading, a field name), never a whole paragraph and no regex; the merge
  step treats every issue with the same `pattern` as the same defect
- **expected**: what the spec should say (what is missing or unclear)
- **actual**: what it says now
- **impact**: why it matters if not addressed
- **recommendation**: the suggested clarification — what to add or change

### Report
Your last action is ONE call to `mcp__plugin_reviewer_review__report_review` with:
- `run_dir`: {run_dir}
- `angle`: {angle_key}
- `files`: one entry for EVERY path in the file list below, none omitted —
  `{path, verdict, issue_count}`, where `verdict` is `clean` (no issues), `skimmed`
  (boilerplate you only glanced at, no issues) or `issues`, and `issue_count` equals the number
  of your issues whose location is in that file
- `issues`: the issues above, or `[]`
- `verdict`: PASS, or FAIL if any CRITICAL or HIGH issue remains

Spec runs have no requirement-coverage section: do not send one.

Your run is INCOMPLETE until the tool returns a line starting with `wrote`. If it returns an error, fix exactly the violations it lists and call again (max 3 attempts). If the tool is not available, write the identical JSON to `{run_dir}/{angle_key}.json` with a Bash heredoc and say `report_review unavailable, wrote file directly`.

After the tool call, print only three lines:
angle: {angle_key}
verdict: PASS | FAIL
issues: N

## File List (from the run manifest)
{file_list}

## Working Directory
{working_directory}
