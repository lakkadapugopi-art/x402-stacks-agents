'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildPaymentRequirements, createPaymentRequired, matchesRequirements,
  createTransactionPayment, verifyTransaction,
} = require('../lib/x402');
const { buildPaymentReceipt, formatReceiptMarkdown } = require('../lib/receipt');
const { recordPayment, listPayments, paymentsLedgerPath } = require('../lib/payments');
const { atomicAmount } = require('../lib/validation');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.stack || error.message }); }
}
function run(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0) throw new Error(`CLI ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const recipient = 'ST000000000000000000002AMW42H';
const payer = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';
const txid = `0x${'55'.repeat(32)}`;

(async () => {
  await check('B-2 numeric amount and lowercase payTo still match', () => {
    const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
    const loose = { ...requirements, amount: 100, payTo: requirements.payTo.toLowerCase() };
    const payment = createTransactionPayment(requirements, txid);
    assert.equal(matchesRequirements(payment, loose), true);
  });
  await check('B-2 mismatched amount still rejected', () => {
    const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
    const payment = createTransactionPayment(requirements, txid);
    assert.equal(matchesRequirements(payment, { ...requirements, amount: '101' }), false);
  });
  await check('B-5 zero and negative amounts share the positive contract', () => {
    assert.throws(() => atomicAmount(0), /positive/);
    assert.throws(() => atomicAmount('0'), /greater than zero/);
    assert.throws(() => atomicAmount(-5), /positive/);
    assert.equal(atomicAmount('100'), '100');
  });
  await check('F-3 multi-accept emits one requirement per token', () => {
    const required = createPaymentRequired({ network: 'testnet', recipient, amount: '100', tokens: ['USDCx', 'sBTC', 'STX'], resourceUrl: 'https://example.com/premium' });
    assert.equal(required.accepts.length, 3);
    assert.equal(required.accepts[0].asset.includes('usdcx'), true);
    assert.equal(required.accepts[1].asset.includes('sbtc'), true);
    assert.equal(required.accepts[2].asset, 'STX');
  });
  await check('F-3 accepts entries can override amount and recipient', () => {
    const required = createPaymentRequired({
      network: 'testnet', recipient, amount: '100', resourceUrl: 'x402://premium',
      accepts: [{ token: 'STX', amount: '250' }, { token: 'sBTC', payTo: payer }],
    });
    assert.equal(required.accepts[0].amount, '250');
    assert.equal(required.accepts[0].payTo, recipient);
    assert.equal(required.accepts[1].payTo, payer);
  });
  await check('F-3 rejects empty and oversized accepts lists', () => {
    assert.throws(() => createPaymentRequired({ network: 'testnet', recipient, amount: '100', resourceUrl: 'x402://p', accepts: [] }), /between 1 and 8/);
    assert.throws(() => createPaymentRequired({ network: 'testnet', recipient, amount: '100', resourceUrl: 'x402://p', tokens: Array(9).fill('STX') }), /between 1 and 8/);
  });
  await check('F-5 SIP-010 memo is extracted and matched', async () => {
    const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
    const transaction = {
      tx_id: txid, tx_status: 'success', tx_type: 'contract_call', block_height: 10, sender_address: payer,
      contract_call: {
        contract_id: requirements.asset, function_name: 'transfer',
        function_args: [{ repr: 'u100' }, { repr: `'${payer}` }, { repr: `'${recipient}` }, { repr: '(some 0x72656631)' }],
      },
    };
    const matched = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'sBTC', transaction, memo: '0x72656631' });
    assert.equal(matched.valid, true); assert.equal(matched.memo, '72656631');
    const mismatch = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'sBTC', transaction, memo: '0x00' });
    assert.equal(mismatch.valid, false); assert.equal(mismatch.reason, 'MEMO_MISMATCH');
    const none = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'sBTC', transaction, memo: '0x72656632' });
    assert.equal(none.reason, 'MEMO_MISMATCH');
  });
  await check('F-5 none memo verifies only when no memo is required', async () => {
    const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
    const transaction = {
      tx_id: txid, tx_status: 'success', tx_type: 'contract_call', block_height: 10, sender_address: payer,
      contract_call: {
        contract_id: requirements.asset, function_name: 'transfer',
        function_args: [{ repr: 'u100' }, { repr: `'${payer}` }, { repr: `'${recipient}` }, { repr: 'none' }],
      },
    };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'sBTC', transaction });
    assert.equal(result.valid, true); assert.equal(result.memo, null);
  });
  await check('F-5 STX token_transfer memo is normalized', async () => {
    const transaction = {
      tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', block_height: 5, sender_address: payer,
      token_transfer: { recipient_address: recipient, amount: '100', memo: '0x72656631' },
    };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'STX', transaction, memo: '72656631' });
    assert.equal(result.valid, true); assert.equal(result.memo, '72656631');
  });
  await check('F-4 wait polls pending transactions until success', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const body = calls < 3
        ? { tx_id: txid, tx_status: 'pending', tx_type: 'token_transfer', block_height: 0, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } }
        : { tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', block_height: 9, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'STX', txid, fetchImpl, wait: true, waitTimeoutMs: 5000, pollIntervalMs: 100 });
    assert.equal(result.valid, true); assert.equal(calls, 3);
  });
  await check('F-4 wait gives up after the bounded timeout', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify({ tx_id: txid, tx_status: 'pending', tx_type: 'token_transfer', block_height: 0, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } }), { status: 200 });
    };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'STX', txid, fetchImpl, wait: true, waitTimeoutMs: 300, pollIntervalMs: 100 });
    assert.equal(result.valid, false); assert.equal(result.reason, 'TRANSACTION_PENDING'); assert.ok(calls >= 1);
  });
  await check('F-1 receipt object and markdown are built from valid results', async () => {
    const transaction = { tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', block_height: 5, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: '100', token: 'STX', transaction });
    const receipt = buildPaymentReceipt(result, { note: 'invoice 42' });
    assert.equal(receipt.receiptVersion, 1); assert.equal(receipt.txid, txid);
    assert.equal(receipt.amount, '100'); assert.equal(receipt.note, 'invoice 42');
    assert.equal(receipt.source, 'chain');
    const markdown = formatReceiptMarkdown(receipt);
    assert.ok(markdown.includes('# Payment Receipt')); assert.ok(markdown.includes(txid)); assert.ok(markdown.includes('invoice 42'));
    assert.throws(() => buildPaymentReceipt({ valid: false, reason: 'X' }), /valid verification result/);
  });
  await check('F-2 payments ledger records once per transaction', () => {
    const ledgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-ledger-test-'));
    try {
      const entry = { valid: true, txid, network: 'stacks:2147483648', amount: '100', recipient, payer };
      const first = recordPayment(ledgerRoot, entry);
      assert.equal(first.entry.recordedAt !== undefined, true);
      assert.equal(listPayments(ledgerRoot).length, 1);
      assert.equal(paymentsLedgerPath(ledgerRoot), path.join(ledgerRoot, '.x402-stacks', 'payments.jsonl'));
      assert.throws(() => recordPayment(ledgerRoot, entry), /already recorded/);
      assert.throws(() => recordPayment(ledgerRoot, { valid: false }), /valid verification results/);
    } finally { fs.rmSync(ledgerRoot, { recursive: true, force: true }); }
  });
  await check('F-6 config init writes defaults and prints next steps', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-config-init-'));
    try {
      const result = JSON.parse(run(['config', 'init', '--root', temporary, '--network', 'testnet', '--amount', '150']));
      assert.equal(result.created, true);
      assert.equal(result.config.amount, '150'); assert.equal(result.config.network, 'testnet');
      assert.equal(result.nextSteps.length, 3);
      const again = spawnSync(process.execPath, [BIN, 'config', 'init', '--root', temporary], { cwd: ROOT, encoding: 'utf8' });
      assert.notEqual(again.status, 0); assert.match(again.stderr, /already exists/);
      const forced = JSON.parse(run(['config', 'init', '--root', temporary, '--force', '--json']));
      assert.equal(forced.created, true);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  await check('CLI payment-required --tokens emits multi-accept requirements', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-tokens-test-'));
    try {
      run(['config', 'init', '--root', temporary, '--recipient', recipient, '--amount', '100']);
      const result = JSON.parse(run(['payment-required', '--root', temporary, '--resource-url', 'https://example.com/premium', '--tokens', 'USDCx,sBTC', '--json']));
      assert.equal(result.paymentRequired.accepts.length, 2);
      assert.equal(result.paymentRequired.accepts[0].asset.includes('usdcx'), true);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  await check('CLI verify --record and --receipt produce ledger entry and receipt file', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cli-receipt-'));
    try {
      run(['config', 'init', '--root', temporary, '--recipient', recipient, '--amount', '100']);
      const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
      const transaction = {
        tx_id: txid, tx_status: 'success', tx_type: 'contract_call', block_height: 10, sender_address: payer,
        contract_call: { contract_id: requirements.asset, function_name: 'transfer', function_args: [{ repr: 'u100' }, { repr: `'${payer}` }, { repr: `'${recipient}` }] },
      };
      const requirementsFile = path.join(temporary, 'requirements.json');
      const transactionFile = path.join(temporary, 'transaction.json');
      fs.writeFileSync(requirementsFile, JSON.stringify(requirements));
      fs.writeFileSync(transactionFile, JSON.stringify(transaction));
      const receiptFile = path.join(temporary, 'receipt.md');
      const signature = run(['payment', 'encode', '--requirements', requirementsFile, '--txid', txid, '--signature', '--root', temporary]);
      run(['payment', 'verify', signature, '--requirements', requirementsFile, '--transaction', transactionFile, '--receipt', receiptFile, '--record', '--root', temporary, '--json']);
      assert.ok(fs.existsSync(receiptFile));
      assert.ok(fs.readFileSync(receiptFile, 'utf8').includes('# Payment Receipt'));
      const ledger = JSON.parse(run(['payments', 'list', '--root', temporary, '--json']));
      assert.equal(ledger.payments.length, 1); assert.equal(ledger.payments[0].txid, txid);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  await check('CLI bare --receipt prints markdown instead of the result', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cli-bare-receipt-'));
    try {
      run(['config', 'init', '--root', temporary, '--recipient', recipient, '--amount', '100', '--token', 'STX']);
      const transaction = { tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', block_height: 10, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } };
      const transactionFile = path.join(temporary, 'transaction.json');
      fs.writeFileSync(transactionFile, JSON.stringify(transaction));
      const output = run(['transaction', 'verify', txid, '--transaction', transactionFile, '--receipt', '--root', temporary]);
      assert.ok(output.startsWith('# Payment Receipt'));
      assert.ok(output.includes(txid));
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  await check('CLI payments record reads a saved verification result', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-cli-record-'));
    try {
      const resultFile = path.join(temporary, 'result.json');
      fs.writeFileSync(resultFile, JSON.stringify({ valid: true, txid: `0x${'66'.repeat(32)}`, amount: '10', recipient, payer }));
      const result = JSON.parse(run(['payments', 'record', resultFile, '--root', temporary, '--json']));
      assert.equal(result.entry.amount, '10');
      assert.equal(listPayments(temporary).length, 1);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
  console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
})();
