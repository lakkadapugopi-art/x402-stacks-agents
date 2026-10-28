'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.stack }); } }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 90000, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-packed-test-'));
try {
  const packOutput = run('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: ROOT });
  const pack = JSON.parse(packOutput)[0];
  const archive = path.join(temporary, pack.filename);
  const installRoot = path.join(temporary, 'install');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', installRoot, archive], { cwd: ROOT });
  const packedRoot = path.join(installRoot, 'node_modules', 'x402-stacks-agents');
  const packedBin = path.join(packedRoot, 'bin', 'cli.js');

  check('packed artifact contains the gitignore template under a pack-safe name', () => {
    assert.ok(fs.existsSync(path.join(packedRoot, 'templates', 'cloudflare-agent', 'gitignore.tpl')));
  });
  check('packed CLI init reproduces project creation including dotfiles', () => {
    const project = path.join(temporary, 'project');
    const output = run(process.execPath, [packedBin, 'init', project, '--name', 'packed-agent', '--recipient', 'ST000000000000000000002AMW42H'], { cwd: ROOT });
    assert.equal(JSON.parse(output).created, true);
    assert.ok(fs.existsSync(path.join(project, '.gitignore')));
    assert.match(fs.readFileSync(path.join(project, '.gitignore'), 'utf8'), /node_modules/);
    assert.ok(fs.existsSync(path.join(project, 'src', 'index.js')));
  });
  check('packed template includes one-time transaction replay protection', () => {
    const source = fs.readFileSync(path.join(temporary, 'project', 'src', 'index.js'), 'utf8');
    assert.ok(source.includes('blockConcurrencyWhile')); assert.ok(source.includes('x402:used:')); assert.ok(source.includes('PAYMENT_REPLAYED'));
  });
  check('packed module loads and preserves official address behavior', () => {
    const api = require(packedRoot);
    assert.equal(api.privateKeyToAddress('73a2f291df5a8ce3ceb668a25ac7af45639513af7596d710ddf59f64f484fd2801', 'mainnet'), 'SP10J81WVGVB3M4PHQN4Q4G0R8586TBJH948RESDR');
  });
  check('packed CLI enforces force confirmation', () => {
    const project = path.join(temporary, 'project');
    const result = spawnSync(process.execPath, [packedBin, 'init', project, '--name', 'packed-agent', '--force'], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Refusing to overwrite/);
  });
  console.log(`PACK ${pack.filename} ${pack.entryCount} files ${pack.unpackedSize} bytes`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
