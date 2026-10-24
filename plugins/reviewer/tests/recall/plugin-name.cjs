'use strict'
// The slash-command prefix of a plugin dir: a renamed copy (reviewer-dev) must be invoked as
// /reviewer-dev:…, otherwise the typed agent names resolve to the installed plugin and the harness
// measures the wrong code. Falls back to "reviewer".
const fs = require('fs')
const path = require('path')
function pluginName(pluginDir) {
  try { return JSON.parse(fs.readFileSync(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')).name || 'reviewer' } catch { return 'reviewer' }
}
module.exports = { pluginName }
