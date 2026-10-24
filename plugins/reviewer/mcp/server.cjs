#!/usr/bin/env node
'use strict'
// Minimal stdio MCP server (newline-delimited JSON-RPC 2.0) exposing report_review and verify_review.
// stdout carries only JSON-RPC lines; diagnostics go to stderr.

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { REPORT_SCHEMA, VERIFY_SCHEMA } = require('./schema.cjs')
const { handleReportReview } = require('./report-review.cjs')
const { handleVerifyReview } = require('./verify-review.cjs')

function readVersion() {
  try {
    const p = path.join(__dirname, '..', '.claude-plugin', 'plugin.json')
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
const VERSION = readVersion()

const TOOL = {
  name: 'report_review',
  description:
    'Submit your structured review report. The server validates it against the run manifest and writes ' +
    '<run_dir>/<angle>.json only if it is valid; on violations it returns an error listing each one — fix them and call again. ' +
    'Every manifest file must appear in files[], and each file\'s issue_count must match the issues pointing at it. ' +
    'If this tool is unavailable, fall back to writing <run_dir>/<angle>.json by hand in the same shape.',
  inputSchema: REPORT_SCHEMA,
}
const VERIFY_TOOL = {
  name: 'verify_review',
  description:
    'Submit a verifier agent\'s verdicts on a batch of merged findings: for each id from <run_dir>/merged.json, ' +
    'status confirmed | refuted | unverified and one line of evidence from the cited location. The server rejects ' +
    'ids merged.json does not hold and writes <run_dir>/verify/<batch>.json only if valid. If this tool is ' +
    'unavailable, fall back to writing that file by hand in the same shape.',
  inputSchema: VERIFY_SCHEMA,
}
const TOOLS = { [TOOL.name]: handleReportReview, [VERIFY_TOOL.name]: handleVerifyReview }

const reply = (id, result) => ({ jsonrpc: '2.0', id, result })
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

function dispatch(msg) {
  const { id, method, params } = msg || {}
  if (typeof method === 'string' && method.startsWith('notifications/')) return undefined
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'reviewer-review', version: VERSION },
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: [TOOL, VERIFY_TOOL] })
    case 'tools/call':
      if (!params || !TOOLS[params.name]) {
        return error(id, -32602, `Unknown tool: ${params && params.name}`)
      }
      return reply(id, TOOLS[params.name](params.arguments))
    default:
      return error(id, -32601, `Method not found: ${method}`)
  }
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch (err) {
      process.stdout.write(JSON.stringify(error(null, -32700, 'Parse error')) + '\n')
      return
    }
    try {
      const res = dispatch(msg)
      if (res !== undefined) process.stdout.write(JSON.stringify(res) + '\n')
    } catch (err) {
      process.stderr.write(`reviewer-review: ${err && err.stack ? err.stack : err}\n`)
      process.stdout.write(JSON.stringify(error(msg && msg.id !== undefined ? msg.id : null, -32603, 'Internal error')) + '\n')
    }
  })
}

if (require.main === module) main()

module.exports = { dispatch }
