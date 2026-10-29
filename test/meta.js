'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.stack || error.message }); }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

check('package version is the single source of truth', () => {
  const { PACKAGE_VERSION } = require('../lib/constants');
  assert.equal(PACKAGE_VERSION, pkg.version);
  const cli = spawnSync(process.execPath, [BIN, '--version'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.stdout.trim(), pkg.version);
  const help = spawnSync(process.execPath, [BIN, '--help'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(help.stdout.includes(`x402-stacks-agents ${pkg.version}`));
});
check('repository metadata is complete', () => {
  assert.equal(pkg.repository.type, 'git');
  assert.ok(/github\.com\/lakkadapugopi-art\/x402-stacks-agents/.test(pkg.repository.url));
  assert.ok(/github\.com\/lakkadapugopi-art\/x402-stacks-agents/.test(pkg.homepage));
  assert.ok(/github\.com\/lakkadapugopi-art\/x402-stacks-agents/.test(pkg.bugs.url));
  assert.equal(typeof pkg.author, 'string');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(readme.includes('https://github.com/lakkadapugopi-art/x402-stacks-agents'));
});
check('TypeScript declarations exist and are wired', () => {
  assert.equal(pkg.types, './index.d.ts');
  for (const file of ['index.d.ts', 'lib/stacks.d.ts', 'lib/x402.d.ts', 'lib/project.d.ts', 'lib/errors.d.ts', 'lib/validation.d.ts']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  }
  assert.ok(pkg.files.includes('index.d.ts'));
  for (const key of ['.', './stacks', './x402', './project', './errors', './validation']) {
    assert.ok(pkg.exports[key] && pkg.exports[key].types, `types condition for ${key}`);
    assert.ok(pkg.exports[key].types.endsWith('.d.ts'));
    assert.ok(fs.existsSync(path.join(ROOT, pkg.exports[key].types)), pkg.exports[key].types);
    assert.ok(fs.existsSync(path.join(ROOT, pkg.exports[key].default)), pkg.exports[key].default);
  }
});
check('no install scripts are declared', () => {
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']) {
    assert.equal(pkg.scripts[name], undefined, name);
  }
});
check('no Korean characters in shipped files', () => {
  const targets = [];
  const walk = (relative) => {
    const full = path.join(ROOT, relative);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'test', 'templates'].includes(entry.name)) continue;
        walk(rel);
      } else if (/\.(js|json|md|ts)$/.test(entry.name) && entry.name !== 'ledger.jsonl') {
        targets.push(rel);
      }
    }
  };
  walk('.');
  targets.push('README.md', 'package.json');
  const korean = /[가-힣]/;
  for (const file of new Set(targets)) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(korean.test(content), false, `Korean text found in ${file}`);
  }
});
check('exports map covers errors and validation subpaths', () => {
  assert.ok(pkg.exports['./errors'], './errors subpath missing');
  assert.ok(pkg.exports['./validation'], './validation subpath missing');
});

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
