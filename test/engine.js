'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { X402Stacks, createPaymentGate } = require('../lib/engine');
const { createTransactionPayment } = require('../lib/x402');
const { createCloudflareAgentProject } = require('../lib/project');

const checks = [];
async function check(name, fn) { try { await fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.stack }); } }
const recipient = 'ST000000000000000000002AMW42H';
const payer = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';
const txid = `0x${'44'.repeat(32)}`;
const transaction = { tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', block_height: 5, sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' } };

(async () => {
  await check('engine creates requirements and 402 Response', async () => {
    const engine = new X402Stacks({ network: 'testnet', recipient, amount: '100' });
    const required = engine.createPaymentRequired({ resourceUrl: 'x402://engine' });
    assert.equal(required.accepts[0].amount, '100'); assert.equal(engine.paymentRequiredResponse(required).status, 402);
  });
  await check('engine forwards API key only in request header', async () => {
    let seen;
    const engine = new X402Stacks({
      network: 'testnet', recipient, amount: '100', token: 'STX', apiKey: 'secret-test-key',
      fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify(transaction)); },
    });
    const result = await engine.verifyTransaction({ txid });
    assert.equal(result.valid, true); assert.equal(seen.init.headers['x-api-key'], 'secret-test-key'); assert.ok(!seen.url.includes('secret-test-key'));
  });
  await check('transport-agnostic gate verifies offline', async () => {
    const engine = new X402Stacks({ network: 'testnet', recipient, amount: '100', token: 'STX' });
    const requirements = engine.buildRequirements();
    const gate = createPaymentGate(engine.config, requirements, { url: 'x402://gate' });
    const payment = createTransactionPayment(requirements, txid);
    const result = await gate.verify(payment, { transaction });
    assert.equal(result.valid, true); assert.equal(gate.paymentRequired().error, 'PAYMENT_REQUIRED');
  });
  await check('engine facilitator preserves runtime fetch and timeout', async () => {
    let seenUrl; let seenTimeout;
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms) => { seenTimeout = ms; return originalTimeout(ms); };
    try {
      const engine = new X402Stacks({
        network: 'testnet', recipient, apiKey: 'hiro-secret', facilitatorApiKey: 'facilitator-secret', timeoutMs: 2345,
        fetchImpl: async (url) => { seenUrl = url; return new Response(JSON.stringify({ isValid: true, payer })); },
      });
      const requirements = engine.buildRequirements();
      const payment = createTransactionPayment(requirements, txid);
      const result = await engine.facilitator({ url: 'https://facilitator.example' }).verify(payment, requirements);
      assert.equal(result.isValid, true); assert.equal(seenUrl, 'https://facilitator.example/verify'); assert.equal(seenTimeout, 2345);
    } finally { AbortSignal.timeout = originalTimeout; }
  });
  await check('project force preserves unrelated files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-engine-test-'));
    try {
      createCloudflareAgentProject({ directory, name: 'engine-agent', recipient });
      fs.writeFileSync(path.join(directory, 'custom.txt'), 'preserve');
      const result = createCloudflareAgentProject({ directory, name: 'engine-agent', recipient, force: true });
      assert.equal(fs.readFileSync(path.join(directory, 'custom.txt'), 'utf8'), 'preserve');
      assert.ok(result.overwritten.some((file) => file.endsWith('package.json'))); assert.ok(result.warnings.length > 0);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
  console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
})();
