'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodePaymentRequired, decodePayment } = require('../lib/x402');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const recipient = 'ST000000000000000000002AMW42H';
const payer = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';
const publicKey = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const txid = `0x${'22'.repeat(32)}`;
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.stack }); } }
function run(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) throw new Error(`CLI ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cli-test-'));
try {
  check('version command', () => assert.equal(run(['--version']), require('../package.json').version));
  check('help lists every command family', () => {
    const help = run(['--help']);
    for (const command of ['init', 'config', 'verify', 'payment-required', 'transaction', 'address', 'mcp-start']) assert.ok(help.includes(command));
  });
  check('init scaffolds wrangler Cloudflare Agent with replay guard and gitignore', () => {
    const result = JSON.parse(run(['init', temporary, '--name', 'demo-agent', '--recipient', recipient]));
    assert.equal(result.created, true);
    for (const file of ['package.json', 'wrangler.jsonc', 'src/index.js', '.dev.vars.example', '.gitignore', '.x402-stacks/config.json']) assert.ok(fs.existsSync(path.join(temporary, file)), file);
    const wrangler = fs.readFileSync(path.join(temporary, 'wrangler.jsonc'), 'utf8');
    assert.ok(wrangler.includes('PaidAgent')); assert.ok(!wrangler.includes('__RECIPIENT__'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary, 'package.json'))).scripts.postinstall, undefined);
    const source = fs.readFileSync(path.join(temporary, 'src/index.js'), 'utf8');
    assert.ok(source.includes('blockConcurrencyWhile')); assert.ok(source.includes('x402:used:')); assert.ok(source.includes('PAYMENT_REPLAYED'));
  });
  check('config set and show share persisted values', () => {
    run(['config', 'set', 'amount', '250', '--root', temporary]);
    assert.equal(JSON.parse(run(['config', 'show', '--root', temporary])).config.amount, '250');
  });
  check('config get rejects unknown keys', () => {
    const result = spawnSync(process.execPath, [BIN, 'config', 'get', 'unknown', '--root', temporary], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Allowed keys/);
  });
  check('json flag emits compact JSON including string values', () => {
    assert.equal(run(['config', 'get', 'amount', '--root', temporary]), '250');
    assert.equal(JSON.parse(run(['config', 'get', 'amount', '--root', temporary, '--json'])), '250');
    const show = run(['config', 'show', '--root', temporary, '--json']);
    assert.ok(!show.includes('\n')); assert.equal(JSON.parse(show).config.amount, '250');
  });
  check('config verify passes with valid recipient', () => assert.equal(JSON.parse(run(['verify', '--root', temporary])).valid, true));
  check('public key derives official testnet address', () => {
    const result = JSON.parse(run(['address', 'from-public-key', publicKey, '--network', 'testnet']));
    assert.equal(result.address, payer);
  });
  check('address validate returns canonical checksum data', () => assert.equal(JSON.parse(run(['address', 'validate', recipient])).valid, true));
  check('public-only wallet generation omits private key', () => {
    const result = JSON.parse(run(['address', 'generate', '--public-only']));
    assert.equal(result.privateKey, undefined); assert.ok(result.address.startsWith('ST'));
  });
  let requirements;
  check('payment-required emits a decodable header', () => {
    const result = JSON.parse(run(['payment-required', '--root', temporary, '--resource-url', 'https://example.com/premium']));
    requirements = decodePaymentRequired(result.header).accepts[0];
    assert.equal(requirements.amount, '250'); assert.equal(requirements.payTo, recipient);
  });
  const requirementsFile = path.join(temporary, 'requirements.json');
  const transactionFile = path.join(temporary, 'transaction.json');
  fs.writeFileSync(requirementsFile, JSON.stringify(requirements));
  fs.writeFileSync(transactionFile, JSON.stringify({
    tx_id: txid, tx_status: 'success', tx_type: 'contract_call', block_height: 10,
    sender_address: payer,
    contract_call: { contract_id: requirements.asset, function_name: 'transfer', function_args: [{ repr: 'u250' }, { repr: `'${payer}` }, { repr: `'${recipient}` }] },
  }));
  let signature;
  check('payment encode emits x402 signature from a direct txid', () => {
    signature = run(['payment', 'encode', '--requirements', requirementsFile, '--txid', txid, '--signature', '--root', temporary]);
    assert.equal(decodePayment(signature).payload.transaction, txid);
  });
  check('payment decode works without config or recipient', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cli-empty-'));
    try { assert.equal(JSON.parse(run(['payment', 'decode', signature, '--root', emptyRoot])).payload.transaction, txid); }
    finally { fs.rmSync(emptyRoot, { recursive: true, force: true }); }
  });
  check('payment encode reads transaction id from JSON file', () => {
    const fromFile = run(['payment', 'encode', '--requirements', requirementsFile, '--transaction', transactionFile, '--signature', '--root', temporary]);
    assert.equal(decodePayment(fromFile).payload.transaction, txid);
  });
  check('payment verify checks offline SIP-010 transaction', () => {
    const result = JSON.parse(run(['payment', 'verify', signature, '--requirements', requirementsFile, '--transaction', transactionFile, '--root', temporary]));
    assert.equal(result.valid, true);
  });
  check('transaction verify command reuses exact payment settings', () => {
    const result = JSON.parse(run(['transaction', 'verify', txid, '--transaction', transactionFile, '--root', temporary]));
    assert.equal(result.valid, true); assert.equal(result.amount, '250');
  });
  check('chain tip height zero is preserved and rejects unconfirmed transaction', () => {
    const result = spawnSync(process.execPath, [BIN, 'transaction', 'verify', txid, '--transaction', transactionFile, '--chain-tip-height', '0', '--root', temporary], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).reason, 'INSUFFICIENT_CONFIRMATIONS');
  });
  check('nonempty init requires explicit force', () => {
    const result = spawnSync(process.execPath, [BIN, 'init', temporary, '--name', 'demo-agent'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Directory is not empty/);
  });
  check('force without yes refuses overwrite and preserves user package', () => {
    const packageFile = path.join(temporary, 'package.json');
    fs.writeFileSync(packageFile, '{"custom":true}\n');
    const result = spawnSync(process.execPath, [BIN, 'init', temporary, '--name', 'demo-agent', '--force'], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Refusing to overwrite/);
    assert.equal(fs.readFileSync(packageFile, 'utf8'), '{"custom":true}\n');
  });
  check('confirmed force warns and overwrites only generated files', () => {
    fs.writeFileSync(path.join(temporary, 'custom.txt'), 'preserve');
    const result = spawnSync(process.execPath, [BIN, 'init', temporary, '--name', 'demo-agent', '--recipient', recipient, '--force', '--yes'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /WARNING Overwriting/);
    const output = JSON.parse(result.stdout); assert.ok(output.overwritten.some((file) => file.endsWith('package.json')));
    assert.equal(fs.readFileSync(path.join(temporary, 'custom.txt'), 'utf8'), 'preserve');
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
