'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextId = 0;
const id = () => ++nextId;
function startServer(viaCli = false) {
  const child = spawn(process.execPath, viaCli ? ['bin/cli.js', 'mcp-start'] : ['mcp-server.js'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  const responses = [];
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (line) { try { responses.push(JSON.parse(line)); } catch { responses.push({ parseError: line }); } }
    }
  });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const sendRaw = (text) => child.stdin.write(`${text}\n`);
  const waitFor = (predicate, timeout = 10000) => new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const hit = responses.find(predicate); if (hit) return resolve(hit);
      if (Date.now() - start > timeout) return reject(new Error('MCP response timeout'));
      setTimeout(tick, 20);
    }; tick();
  });
  return { child, responses, send, sendRaw, waitFor, stop: () => child.stdin.end() };
}

async function main() {
  const checks = [];
  const expect = (name, condition, detail) => { checks.push({ name, ok: !!condition }); if (!condition) process.stderr.write(`FAIL ${name}${detail ? `: ${detail}` : ''}\n`); };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-mcp-test-'));
  const s = startServer();
  const call = async (name, args = {}) => {
    const requestId = id(); s.send({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } });
    return s.waitFor((message) => message.id === requestId);
  };
  const text = (response) => response.result?.content?.[0]?.text || '';
  const parsed = (response) => { try { return JSON.parse(text(response)); } catch { return null; } };
  const recipient = 'ST000000000000000000002AMW42H';
  const payer = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';
  const publicKey = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
  const txid = `0x${'33'.repeat(32)}`;

  const initializeId = id();
  s.send({ jsonrpc: '2.0', id: initializeId, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0.0' } } });
  const initialized = await s.waitFor((message) => message.id === initializeId);
  expect('initialize protocol and serverInfo', initialized.result?.protocolVersion === '2025-06-18' && initialized.result?.serverInfo.name === 'x402-stacks-agents');
  const notificationCount = s.responses.length;
  s.send({ jsonrpc: '2.0', method: 'notifications/initialized' }); s.send({ jsonrpc: '2.0', method: 'ping' }); s.send({ jsonrpc: '2.0', method: 'tools/list' });
  await sleep(200); expect('notifications receive no responses', s.responses.length === notificationCount);
  const pingId = id(); s.send({ jsonrpc: '2.0', id: pingId, method: 'ping' });
  const ping = await s.waitFor((message) => message.id === pingId); expect('ping returns empty result', ping.result && Object.keys(ping.result).length === 0);
  const listId = id(); s.send({ jsonrpc: '2.0', id: listId, method: 'tools/list' });
  const list = await s.waitFor((message) => message.id === listId); const tools = list.result.tools;
  expect('exactly eight tools are exposed', tools.length === 8, tools.map((tool) => tool.name).join(','));
  expect('tool schemas have descriptions and closed input objects', tools.every((tool) => tool.description && tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties === false));

  let response = await call('x402_stacks_address_validate', { address: recipient, network: 'testnet' });
  expect('address validation tool works', parsed(response)?.valid === true, text(response));
  response = await call('x402_stacks_address_from_public_key', { public_key: publicKey, network: 'testnet' });
  expect('public key derivation matches official vector', parsed(response)?.address === payer, text(response));
  response = await call('x402_stacks_wallet_generate', { network: 'testnet' });
  expect('wallet tool omits private key by default', parsed(response)?.address && !parsed(response)?.privateKey);
  response = await call('x402_stacks_wallet_generate', { network: 'mainnet', include_private_key: true });
  expect('explicit wallet export includes a real private key', /^[0-9a-f]{66}$/.test(parsed(response)?.privateKey || ''));

  response = await call('x402_payment_requirements', { network: 'testnet', recipient, amount: '100', token: 'sBTC', resource_url: 'https://example.com/premium' });
  const requirementResult = parsed(response);
  const requirements = requirementResult?.paymentRequired.accepts[0];
  expect('payment requirements tool emits header and exact requirement', requirements?.amount === '100' && requirementResult?.paymentRequiredHeader.length > 0, text(response));
  response = await call('x402_payment_encode', { requirements, transaction: txid });
  const encoded = parsed(response);
  expect('payment encode tool emits payload and signature', encoded?.payment.payload.transaction === txid && encoded?.paymentSignature.length > 0, text(response));
  const transaction = {
    tx_id: txid, tx_status: 'success', tx_type: 'contract_call', block_height: 20, sender_address: payer,
    contract_call: { contract_id: requirements.asset, function_name: 'transfer', function_args: [{ repr: 'u100' }, { repr: `'${payer}` }, { repr: `'${recipient}` }] },
  };
  response = await call('x402_stacks_transaction_verify', { network: 'testnet', recipient, amount: '100', token: 'sBTC', transaction, chain_tip_height: 21, min_confirmations: 2 });
  expect('transaction tool verifies SIP-010 and confirmations', parsed(response)?.valid === true && parsed(response)?.confirmations === 2, text(response));
  response = await call('x402_payment_verify', { payment: encoded.paymentSignature, requirements, transaction });
  expect('payment verify tool verifies encoded payment offline', parsed(response)?.valid === true, text(response));
  response = await call('x402_project_init', { directory: temporary, name: 'mcp-agent', network: 'testnet', recipient, amount: '100' });
  expect('project tool creates a wrangler template', parsed(response)?.name === 'mcp-agent' && fs.existsSync(path.join(temporary, 'wrangler.jsonc')), text(response));

  response = await call('x402_payment_requirements', { recipient, amount: '100', resource_url: 'https://example.com', unexpected: true });
  expect('additional properties are rejected with -32602', response.error?.code === -32602);
  response = await call('x402_payment_encode', { requirements });
  expect('missing required arguments are rejected with -32602', response.error?.code === -32602);
  response = await call('x402_stacks_address_validate', { address: recipient, network: 'mainnet' });
  expect('network mismatch returns a negative validation result', parsed(response)?.valid === false);
  response = await call('not_a_tool', {});
  expect('unknown tool returns -32602', response.error?.code === -32602);

  const batchStart = s.responses.length; s.send([{ jsonrpc: '2.0', id: id(), method: 'ping' }]); await sleep(200);
  const batch = s.responses.slice(batchStart)[0]; expect('latest protocol rejects batch requests', batch?.error?.code === -32600 && /batching/.test(batch.error.message));
  s.sendRaw('{bad json'); const parseError = await s.waitFor((message) => message.error?.code === -32700); expect('malformed JSON returns -32700', !!parseError);
  const malformedStart = s.responses.length; s.sendRaw('{}');
  const malformedRequest = await s.waitFor((message) => s.responses.indexOf(message) >= malformedStart && message.error?.code === -32600);
  expect('id-less malformed Request returns -32600', malformedRequest.error?.code === -32600);
  expect('stdout contains only valid JSON messages', !s.responses.some((message) => message.parseError)); s.stop(); await sleep(150);

  const legacy = startServer(true); const legacyInit = id();
  legacy.send({ jsonrpc: '2.0', id: legacyInit, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } } });
  const negotiated = await legacy.waitFor((message) => message.id === legacyInit); expect('CLI MCP server negotiates older protocol', negotiated.result?.protocolVersion === '2025-03-26');
  legacy.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const notificationBatchStart = legacy.responses.length;
  legacy.send([{ jsonrpc: '2.0', method: 'notifications/initialized' }]); await sleep(200);
  expect('notification-only legacy batch emits no empty array', legacy.responses.length === notificationBatchStart);
  legacy.send([{}]);
  const malformedBatch = await legacy.waitFor((message) => Array.isArray(message) && message[0]?.error?.code === -32600);
  expect('legacy batch preserves malformed Request error', Array.isArray(malformedBatch) && malformedBatch[0].error.code === -32600);
  const legacyBatchId = id(); legacy.send([{ jsonrpc: '2.0', id: legacyBatchId, method: 'ping' }]);
  const legacyBatch = await legacy.waitFor((message) => Array.isArray(message) && message[0]?.id === legacyBatchId); expect('older protocol receives batch array response', Array.isArray(legacyBatch) && !!legacyBatch[0].result); legacy.stop();

  const earlyServer = startServer(); const early = id(); earlyServer.send({ jsonrpc: '2.0', id: early, method: 'ping' });
  const earlyResponse = await earlyServer.waitFor((message) => message.id === early); expect('request before initialize returns -32002', earlyResponse.error?.code === -32002);
  const empty = id(); earlyServer.send({ jsonrpc: '2.0', id: empty, method: 'initialize', params: {} });
  const emptyResponse = await earlyServer.waitFor((message) => message.id === empty); expect('empty initialize returns -32602', emptyResponse.error?.code === -32602); earlyServer.stop();

  const oversizedServer = startServer(); const oversizedInit = id();
  oversizedServer.send({ jsonrpc: '2.0', id: oversizedInit, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oversized', version: '1.0.0' } } });
  await oversizedServer.waitFor((message) => message.id === oversizedInit);
  oversizedServer.child.stdin.write('x'.repeat(1100001));
  const oversizedError = await oversizedServer.waitFor((message) => /maximum stdin line size/.test(message.error?.message || ''));
  expect('stdin buffer is bounded', oversizedError.error?.code === -32600);
  oversizedServer.child.stdin.write('\n');
  const afterOverflow = id(); oversizedServer.send({ jsonrpc: '2.0', id: afterOverflow, method: 'ping' });
  const overflowRecovery = await oversizedServer.waitFor((message) => message.id === afterOverflow);
  expect('server recovers after oversized line', !!overflowRecovery.result); oversizedServer.stop();

  for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
  console.log(`RESULT ${checks.filter((check) => check.ok).length}/${checks.length} checks passed`);
  fs.rmSync(temporary, { recursive: true, force: true });
  process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
