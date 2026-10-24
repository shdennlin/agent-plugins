#!/usr/bin/env bash
# Compatibility wrapper: the logger is scripts/log-findings.cjs (history row v2). Prompts that still
# name log-findings.sh keep working; this file goes away in a later release.
exec node "$(dirname "${BASH_SOURCE[0]}")/log-findings.cjs" "$@"
