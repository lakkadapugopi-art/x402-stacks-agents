#!/usr/bin/env node
'use strict';

const { TOOLS } = require('./lib/mcp-tools');
const { validateSchema, assertObject } = require('./lib/validation');
const { PROTOCOL_VERSION, PACKAGE_VERSION } = require('./lib/constants');
const { ValidationError } = require('./lib/errors');

const SUPPORTED_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const MAX_STDIN_BUFFER = 1100000;
const INITIALIZE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['protocolVersion', 'capabilities', 'clientInfo'],
  properties: {
    protocolVersion: { type: 'string', minLength: 1 }, capabilities: { type: 'object' },
    clientInfo: {
      type: 'object', additionalProperties: false, required: ['name', 'version'],
      properties: { name: { type: 'string', minLength: 1 }, version: { type: 'string', minLength: 1 } },
    },
  },
};

function startServer(options = {}) {
  const root = options.root || process.cwd();
  let protocolVersion = null;
  let initialized = false;
  let buffer = '';
  let discardOversizedLine = false;
  let queue = Promise.resolve();
  const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
  const write = (message) => { if (message !== undefined) process.stdout.write(`${JSON.stringify(message)}\n`); };
  const response = (id, result) => ({ jsonrpc: '2.0', id, result });
  const failure = (id, code, message, data) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message, ...(data === undefined ? {} : { data }) } });

  function initialize(id, params, emit) {
    assertObject(params, 'params');
    validateSchema(params, INITIALIZE_SCHEMA, 'params');
    protocolVersion = SUPPORTED_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION;
    initialized = true;
    emit(response(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'x402-stacks-agents', version: PACKAGE_VERSION },
      instructions: 'Stacks x402 payment, address, transaction verification, and Cloudflare Agents project tools.',
    }));
  }

  async function toolCall(id, params, emit) {
    assertObject(params, 'params');
    if (typeof params.name !== 'string') throw new ValidationError('Tool name is required', 'params.name');
    const tool = byName.get(params.name);
    if (!tool) { emit(failure(id, -32602, `Unknown tool: ${params.name}`)); return; }
    const args = params.arguments === undefined ? {} : params.arguments;
    validateSchema(args, tool.inputSchema, 'params.arguments');
    try {
      const result = await tool.handler(args, { root });
      emit(response(id, { content: [{ type: 'text', text: JSON.stringify(result) }] }));
    } catch (error) {
      emit(response(id, { isError: true, content: [{ type: 'text', text: `${error.code || 'DOMAIN_ERROR'}: ${error.message}` }] }));
    }
  }

  async function handleOne(message, emit) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) { emit(failure(null, -32600, 'Invalid Request')); return; }
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id = hasId ? message.id : null;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') { emit(failure(hasId ? id : null, -32600, 'Invalid Request')); return; }
    if (!hasId) return;
    if (!initialized && message.method !== 'initialize') { emit(failure(id, -32002, 'Server not initialized')); return; }
    try {
      if (message.method === 'initialize') { initialize(id, message.params, emit); return; }
      if (message.method === 'ping') { emit(response(id, {})); return; }
      if (message.method === 'tools/list') { emit(response(id, { tools: TOOLS.map(({ handler, ...tool }) => tool) })); return; }
      if (message.method === 'tools/call') { await toolCall(id, message.params, emit); return; }
      if (message.method === 'shutdown') { emit(response(id, null)); return; }
      emit(failure(id, -32601, `Method not found: ${message.method}`));
    } catch (error) {
      emit(error instanceof ValidationError ? failure(id, -32602, 'Invalid params', error.message) : failure(id, -32603, 'Internal error', error.message));
    }
  }

  async function handle(message) {
    if (Array.isArray(message)) {
      if (protocolVersion === PROTOCOL_VERSION) { write(failure(null, -32600, 'JSON-RPC batching is not supported by protocol version 2025-06-18')); return; }
      if (message.length === 0) { write(failure(null, -32600, 'Invalid Request')); return; }
      const results = [];
      for (const item of message) await handleOne(item, (value) => { if (value !== undefined) results.push(value); });
      if (results.length > 0) write(results);
      return;
    }
    await handleOne(message, write);
  }

  function receive(line) {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { write(failure(null, -32700, 'Parse error')); return; }
    queue = queue.then(() => handle(message)).catch((error) => write(failure(null, -32603, 'Internal error', error.message)));
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (discardOversizedLine) {
      const newline = chunk.indexOf('\n');
      if (newline < 0) return;
      chunk = chunk.slice(newline + 1);
      discardOversizedLine = false;
    }
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > MAX_STDIN_BUFFER) { write(failure(null, -32600, 'Invalid Request: maximum stdin line size exceeded')); continue; }
      receive(line);
    }
    if (buffer.length > MAX_STDIN_BUFFER) {
      buffer = '';
      discardOversizedLine = true;
      write(failure(null, -32600, 'Invalid Request: maximum stdin line size exceeded'));
    }
  });
  process.stdin.on('end', () => { if (!discardOversizedLine && buffer.trim()) receive(buffer); });
  return { tools: TOOLS };
}

if (require.main === module) startServer();
module.exports = { startServer, TOOLS };
