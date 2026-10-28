'use strict';
const assert = require('node:assert/strict');
const {
  buildPaymentRequirements, createPaymentRequired, encodePaymentRequired, decodePaymentRequired,
  createTransactionPayment, encodePayment, decodePayment, matchesRequirements,
  paymentRequiredResponse, verifyTransaction, verifyPayment, settlePayment, httpFacilitator,
} = require('../lib/x402');

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.stack || error.message }); }
}
const recipient = 'ST000000000000000000002AMW42H';
const payer = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';
const txid = `0x${'11'.repeat(32)}`;
const requirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'sBTC' });
const stxRequirements = buildPaymentRequirements({ network: 'testnet', recipient, amount: '100', token: 'STX' });
const stxTransaction = {
  tx_id: txid, tx_status: 'success', tx_type: 'token_transfer', network: 'testnet', block_height: 50,
  sender_address: payer, token_transfer: { recipient_address: recipient, amount: '100' },
};
const tokenTransaction = {
  tx_id: txid, tx_status: 'success', tx_type: 'contract_call', network: 'testnet', block_height: 50,
  sender_address: payer,
  contract_call: {
    contract_id: requirements.asset, function_name: 'transfer',
    function_args: [{ repr: 'u100' }, { repr: `'${payer}` }, { repr: `'${recipient}` }, { repr: 'none' }],
  },
};

(async () => {
  await check('requirements use x402 v2 CAIP-2 and SIP-010 asset', () => {
    assert.equal(requirements.scheme, 'exact'); assert.equal(requirements.network, 'stacks:2147483648');
    assert.equal(requirements.payTo, recipient); assert.match(requirements.asset, /^ST1PQ.*\.sbtc-token$/);
  });
  await check('payment-required header round trip', () => {
    const required = createPaymentRequired({ network: 'testnet', recipient, amount: 100, resourceUrl: 'https://example.com/premium' });
    assert.deepEqual(decodePaymentRequired(encodePaymentRequired(required)), required);
  });
  await check('HTTP 402 response contains encoded header', async () => {
    const required = createPaymentRequired({ network: 'testnet', recipient, amount: 100, resourceUrl: 'x402://premium' });
    const response = paymentRequiredResponse(required);
    assert.equal(response.status, 402); assert.deepEqual(await response.json(), required);
    assert.ok(response.headers.get('payment-required'));
  });
  await check('payment payload round trip and exact matching', () => {
    const payment = createTransactionPayment(requirements, txid);
    assert.deepEqual(decodePayment(encodePayment(payment)), payment);
    assert.equal(matchesRequirements(payment, requirements), true);
    assert.equal(matchesRequirements(payment, stxRequirements), false);
  });
  await check('confirmed STX transfer verifies with three confirmations', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'STX', transaction: stxTransaction, chainTipHeight: 52, minConfirmations: 3 });
    assert.equal(result.valid, true); assert.equal(result.confirmations, 3); assert.equal(result.payer, payer);
  });
  await check('insufficient confirmations are rejected', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'STX', transaction: stxTransaction, chainTipHeight: 50, minConfirmations: 2 });
    assert.equal(result.valid, false); assert.equal(result.reason, 'INSUFFICIENT_CONFIRMATIONS');
  });
  await check('pending transaction is rejected', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'STX', transaction: { ...stxTransaction, tx_status: 'pending' } });
    assert.equal(result.reason, 'TRANSACTION_PENDING');
  });
  await check('amount mismatch is rejected', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 101, token: 'STX', transaction: stxTransaction });
    assert.equal(result.reason, 'AMOUNT_MISMATCH');
  });
  await check('recipient mismatch is rejected', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient: payer, amount: 100, token: 'STX', transaction: stxTransaction });
    assert.equal(result.reason, 'RECIPIENT_MISMATCH');
  });
  await check('network mismatch is rejected', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'STX', transaction: { ...stxTransaction, network: 'mainnet' } });
    assert.equal(result.reason, 'NETWORK_MISMATCH');
  });
  await check('SIP-010 sBTC transfer verifies', async () => {
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'sBTC', transaction: tokenTransaction });
    assert.equal(result.valid, true); assert.equal(result.asset, requirements.asset);
  });
  await check('wrong token contract is rejected', async () => {
    const transaction = { ...tokenTransaction, contract_call: { ...tokenTransaction.contract_call, contract_id: `${payer}.wrong` } };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'sBTC', transaction });
    assert.equal(result.reason, 'UNEXPECTED_TOKEN_CONTRACT_OR_FUNCTION');
  });
  await check('Clarity hex amount and principal decode', async () => {
    const amountHex = `0x01${'00'.repeat(15)}64`;
    const principalHex = `0x051a${'00'.repeat(20)}`;
    const transaction = { ...tokenTransaction, contract_call: { ...tokenTransaction.contract_call, function_args: [{ hex: amountHex }, { repr: `'${payer}` }, { hex: principalHex }] } };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'sBTC', transaction });
    assert.equal(result.valid, true);
  });
  await check('encoded txid payment verifies entirely offline', async () => {
    const payment = createTransactionPayment(stxRequirements, txid);
    const result = await verifyPayment(encodePayment(payment), stxRequirements, { transaction: stxTransaction });
    assert.equal(result.valid, true);
  });
  await check('malformed payment returns a domain failure', async () => {
    const result = await verifyPayment('not-base64!', requirements, {});
    assert.equal(result.valid, false); assert.equal(result.reason, 'INVALID_PAYMENT');
  });
  await check('facilitator verifies raw signed transaction', async () => {
    const payment = encodePayment({ x402Version: 2, accepted: requirements, payload: { transaction: 'deadbeef' } });
    const result = await verifyPayment(payment, requirements, { facilitator: { verify: async () => ({ isValid: true, payer }) } });
    assert.equal(result.valid, true); assert.equal(result.payer, payer);
  });
  await check('settlement calls facilitator and preserves receipt', async () => {
    const payment = createTransactionPayment(requirements, txid);
    const result = await settlePayment(payment, requirements, { facilitator: { settle: async () => ({ success: true, transaction: txid, network: requirements.network }) } });
    assert.equal(result.success, true); assert.equal(result.transaction, txid);
  });
  await check('API fetch path uses transaction endpoint and chain tip', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      const body = url.endsWith('/v2/info') ? { stacks_tip_height: 55 } : stxTransaction;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const result = await verifyTransaction({ network: 'testnet', recipient, amount: 100, token: 'STX', txid, fetchImpl, minConfirmations: 2 });
    assert.equal(result.valid, true); assert.equal(result.confirmations, 6); assert.equal(urls.length, 2);
    assert.ok(urls[0].endsWith(`/extended/v1/tx/${txid}`));
  });

  await check('requirement asset takes precedence over caller token option', async () => {
    const payment = createTransactionPayment(requirements, txid);
    const result = await verifyPayment(encodePayment(payment), requirements, { transaction: tokenTransaction, token: 'USDCx' });
    assert.equal(result.valid, true); assert.equal(result.asset, requirements.asset);
  });
  await check('unknown requirement asset cannot be overridden by caller token', async () => {
    const customRequirements = { ...requirements, asset: `${payer}.unknown` };
    const payment = createTransactionPayment(customRequirements, txid);
    const result = await verifyPayment(encodePayment(payment), customRequirements, { transaction: tokenTransaction, token: 'sBTC' });
    assert.equal(result.valid, false); assert.equal(result.reason, 'UNSUPPORTED_ASSET');
  });
  await check('txid lookup failures return the same error contract as facilitator failures', async () => {
    const payment = createTransactionPayment(requirements, txid);
    const result = await verifyPayment(encodePayment(payment), requirements, {
      fetchImpl: async () => { throw new Error('offline test failure'); },
    });
    assert.equal(result.valid, false); assert.equal(result.reason, 'STACKS_API_UNREACHABLE');
  });
  await check('facilitator receives only its explicit dedicated API key', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ isValid: true })); };
    const facilitator = httpFacilitator('https://facilitator.example', { apiKey: 'hiro-secret', facilitatorApiKey: 'facilitator-secret', fetchImpl });
    const payment = createTransactionPayment(requirements, txid);
    await facilitator.verify(payment, requirements);
    assert.equal(seen[0].init.headers['x-api-key'], 'facilitator-secret');
    assert.ok(!JSON.stringify(seen[0]).includes('hiro-secret'));
    const withoutDedicatedKey = httpFacilitator('https://facilitator.example', { apiKey: 'hiro-secret', fetchImpl });
    await withoutDedicatedKey.verify(payment, requirements);
    assert.equal(seen[1].init.headers['x-api-key'], undefined);
    assert.ok(!JSON.stringify(seen[1]).includes('hiro-secret'));
  });

  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `\n${item.error}` : ''}`);
  console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
})();
