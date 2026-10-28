'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const suites = ['stacks.js', 'x402.js', 'engine.js', 'cli.js', 'mcp-smoke.js'];
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit', timeout: 60000 });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
