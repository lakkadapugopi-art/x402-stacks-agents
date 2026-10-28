'use strict';

const { HEADERS, PROTOCOL_VERSION } = require('./constants');
const { resolveNetwork, normalizeToken, assetId, validateStacksAddress, normalizeTransactionId } = require('./stacks');
const { ValidationError, PaymentError } = require('./errors');
const { assertObject, requiredString, atomicAmount, boundedInteger, httpUrl } = require('./validation');

function buildPaymentRequirements(options) {
  assertObject(options, 'options');
  const network = resolveNetwork(options.network || 'testnet');
  const recipient = options.recipient || options.payTo;
  const address = validateStacksAddress(recipient, network);
  const token = normalizeToken(options.token || 'sBTC');
  const maxTimeoutSeconds = boundedInteger(options.maxTimeoutSeconds === undefined ? 300 : options.maxTimeoutSeconds, 'maxTimeoutSeconds', 1, 86400);
  return {
    scheme: 'exact',
    network: network.caip2,
    amount: atomicAmount(options.amount),
    asset: assetId(token, network),
    payTo: address.address,
    maxTimeoutSeconds,
  };
}

function validateRequirements(requirements, path = 'requirements') {
  assertObject(requirements, path);
  if (requirements.scheme !== 'exact') throw new ValidationError('Only the exact scheme is supported', `${path}.scheme`);
  const network = resolveNetwork(requirements.network);
  atomicAmount(requirements.amount, `${path}.amount`);
  validateStacksAddress(requirements.payTo, network);
  if (typeof requirements.asset !== 'string' || !requirements.asset) throw new ValidationError('Expected an asset identifier', `${path}.asset`);
  boundedInteger(requirements.maxTimeoutSeconds, `${path}.maxTimeoutSeconds`, 1, 86400);
  return requirements;
}

function createPaymentRequired(options) {
  assertObject(options, 'options');
  const resourceUrl = options.resourceUrl || options.resource?.url;
  const resource = {
    url: httpUrl(resourceUrl, 'resource.url', true),
    description: options.description || options.resource?.description || 'Stacks x402 payment required',
    mimeType: options.mimeType || options.resource?.mimeType || 'application/json',
  };
  requiredString(resource.description, 'resource.description', { maxLength: 1024 });
  requiredString(resource.mimeType, 'resource.mimeType', { maxLength: 128 });
  return {
    x402Version: 2,
    error: options.error || 'PAYMENT_REQUIRED',
    resource,
    accepts: [buildPaymentRequirements(options)],
  };
}

function validatePaymentRequired(required) {
  assertObject(required, 'paymentRequired');
  if (required.x402Version !== 2) throw new ValidationError('x402Version must be 2', 'paymentRequired.x402Version');
  assertObject(required.resource, 'paymentRequired.resource');
  httpUrl(required.resource.url, 'paymentRequired.resource.url', true);
  if (!Array.isArray(required.accepts) || required.accepts.length === 0) throw new ValidationError('At least one payment requirement is required', 'paymentRequired.accepts');
  required.accepts.forEach((item, index) => validateRequirements(item, `paymentRequired.accepts[${index}]`));
  return required;
}

function encodeBase64Json(value, maximumLength = 16384) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  if (encoded.length > maximumLength) throw new ValidationError(`Encoded value exceeds ${maximumLength} characters`);
  return encoded;
}

function decodeBase64Json(encoded, maximumLength = 16384) {
  requiredString(encoded, 'encoded', { maxLength: maximumLength });
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) {
    throw new ValidationError('Invalid base64 payload');
  }
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')); }
  catch { throw new ValidationError('Payload is not valid base64-encoded JSON'); }
  return parsed;
}

function encodePaymentRequired(required) {
  validatePaymentRequired(required);
  return encodeBase64Json(required);
}

function decodePaymentRequired(encoded) {
  return validatePaymentRequired(decodeBase64Json(encoded));
}

function createPaymentPayload(options) {
  assertObject(options, 'options');
  const requirements = validateRequirements(options.requirements);
  requiredString(options.transaction, 'transaction', { maxLength: 1000000 });
  if (options.extensions !== undefined) assertObject(options.extensions, 'extensions');
  const payload = {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: options.transaction },
  };
  if (options.resource !== undefined) payload.resource = options.resource;
  if (options.extensions !== undefined) payload.extensions = options.extensions;
  return payload;
}

function createTransactionPayment(requirements, txid) {
  return createPaymentPayload({ requirements, transaction: normalizeTransactionId(txid) });
}

function validatePaymentPayload(payment) {
  assertObject(payment, 'payment');
  if (payment.x402Version !== 2) throw new ValidationError('x402Version must be 2', 'payment.x402Version');
  validateRequirements(payment.accepted, 'payment.accepted');
  assertObject(payment.payload, 'payment.payload');
  requiredString(payment.payload.transaction, 'payment.payload.transaction', { maxLength: 1000000 });
  return payment;
}

function encodePayment(payment) {
  validatePaymentPayload(payment);
  return encodeBase64Json(payment, 1000000);
}

function decodePayment(encoded) {
  return validatePaymentPayload(decodeBase64Json(encoded, 1000000));
}

function matchesRequirements(payment, requirements) {
  try {
    validatePaymentPayload(payment);
    validateRequirements(requirements);
  } catch {
    return false;
  }
  const accepted = payment.accepted;
  return payment.x402Version === 2 && accepted.scheme === requirements.scheme
    && accepted.network === requirements.network && accepted.asset === requirements.asset
    && accepted.payTo === requirements.payTo && accepted.amount === requirements.amount;
}

function paymentRequiredResponse(required, status = 402) {
  validatePaymentRequired(required);
  return new Response(JSON.stringify(required), {
    status,
    headers: {
      'content-type': 'application/json',
      [HEADERS.paymentRequired]: encodePaymentRequired(required),
      'cache-control': 'no-store',
    },
  });
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new PaymentError('FETCH_UNAVAILABLE', 'A Fetch API implementation is required');
  const timeoutMs = boundedInteger(options.timeoutMs === undefined ? 10000 : options.timeoutMs, 'timeoutMs', 1, 120000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: { accept: 'application/json', ...(options.headers || {}), ...(options.body ? { 'content-type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new PaymentError('STACKS_API_UNREACHABLE', `Request failed: ${error.message}`);
  }
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text.slice(0, 500) }; }
  if (!response.ok) throw new PaymentError('STACKS_API_ERROR', `HTTP ${response.status} from Stacks API`, { status: response.status, body });
  return body;
}

async function fetchStacksJson(url, options = {}) {
  const hiroApiKey = options.hiroApiKey || options.apiKey;
  return fetchJson(url, {
    ...options,
    headers: { ...(hiroApiKey ? { 'x-api-key': hiroApiKey } : {}) },
  });
}

function invalid(reason, extra = {}) {
  return { valid: false, reason, ...extra };
}

function clarityUint(argument) {
  if (!argument || typeof argument !== 'object') return null;
  if (typeof argument.repr === 'string' && /^u[0-9]+$/.test(argument.repr)) return argument.repr.slice(1);
  if (typeof argument.hex === 'string' && /^0x01[0-9a-fA-F]{32}$/.test(argument.hex)) return BigInt(`0x${argument.hex.slice(4)}`).toString();
  return null;
}

function clarityPrincipal(argument) {
  if (!argument || typeof argument !== 'object') return null;
  if (typeof argument.repr === 'string') {
    const match = argument.repr.match(/'?(S[0-9A-Z]+)(?:\.[A-Za-z0-9_-]+)?/);
    if (match) return match[1];
  }
  if (typeof argument.hex === 'string' && /^0x0[56][0-9a-fA-F]{42}/.test(argument.hex)) {
    const version = Number.parseInt(argument.hex.slice(4, 6), 16);
    const hash160 = argument.hex.slice(6, 46);
    const { c32Address } = require('./stacks');
    return c32Address(version, hash160);
  }
  return null;
}

function extractTransfer(transaction, network, token) {
  if (token === 'STX') {
    if (transaction.tx_type !== 'token_transfer' || !transaction.token_transfer) return invalid('NOT_AN_STX_TOKEN_TRANSFER');
    return {
      amount: String(transaction.token_transfer.amount || ''),
      recipient: transaction.token_transfer.recipient_address,
      payer: transaction.sender_address,
    };
  }
  if (transaction.tx_type !== 'contract_call' || !transaction.contract_call) return invalid('NOT_A_SIP010_CONTRACT_CALL');
  const call = transaction.contract_call;
  if (call.contract_id !== assetId(token, network) || call.function_name !== 'transfer') return invalid('UNEXPECTED_TOKEN_CONTRACT_OR_FUNCTION');
  const args = Array.isArray(call.function_args) ? call.function_args : [];
  return {
    amount: clarityUint(args[0]),
    recipient: clarityPrincipal(args[2]),
    payer: clarityPrincipal(args[1]) || transaction.sender_address,
  };
}

async function verifyTransaction(options) {
  assertObject(options, 'options');
  const network = resolveNetwork(options.network || 'testnet');
  const token = normalizeToken(options.token || 'sBTC');
  const expectedRecipient = validateStacksAddress(options.recipient || options.payTo, network).address;
  const expectedAmount = atomicAmount(options.amount);
  const minConfirmations = boundedInteger(options.minConfirmations === undefined ? 1 : options.minConfirmations, 'minConfirmations', 1, 10000);
  let txid = options.txid === undefined ? undefined : normalizeTransactionId(options.txid);
  let transaction = options.transaction;
  if (transaction !== undefined) assertObject(transaction, 'transaction');
  if (!transaction && !txid) throw new ValidationError('A transaction id or transaction object is required', 'txid');
  if (transaction && transaction.tx_id) {
    const transactionId = normalizeTransactionId(transaction.tx_id);
    if (txid && txid !== transactionId) return invalid('TRANSACTION_ID_MISMATCH');
    txid = transactionId;
  }
  const apiUrl = (options.apiUrl || network.apiUrl).replace(/\/$/, '');
  httpUrl(apiUrl, 'apiUrl');
  if (!transaction) {
    transaction = await fetchStacksJson(`${apiUrl}/extended/v1/tx/${txid}`, options);
  }
  if (transaction.network) {
    try {
      if (resolveNetwork(transaction.network).name !== network.name) return invalid('NETWORK_MISMATCH');
    } catch { return invalid('NETWORK_MISMATCH'); }
  }
  if (transaction.tx_status !== 'success') {
    return invalid(transaction.tx_status === 'pending' ? 'TRANSACTION_PENDING' : 'TRANSACTION_NOT_SUCCESSFUL', { status: transaction.tx_status || 'unknown' });
  }
  let chainTipHeight = options.chainTipHeight;
  if (chainTipHeight !== undefined) boundedInteger(chainTipHeight, 'chainTipHeight', 0, Number.MAX_SAFE_INTEGER);
  if (minConfirmations > 1 && chainTipHeight === undefined) {
    const info = await fetchStacksJson(`${apiUrl}/v2/info`, options);
    chainTipHeight = info.stacks_tip_height;
  }
  let confirmations = 1;
  if (chainTipHeight !== undefined) {
    if (!Number.isInteger(transaction.block_height)) return invalid('CONFIRMATIONS_UNAVAILABLE');
    confirmations = Math.max(0, chainTipHeight - transaction.block_height + 1);
  }
  if (confirmations < minConfirmations) return invalid('INSUFFICIENT_CONFIRMATIONS', { confirmations, required: minConfirmations });
  const transfer = extractTransfer(transaction, network, token);
  if (transfer.valid === false) return transfer;
  if (transfer.amount === null || !/^[0-9]+$/.test(String(transfer.amount))) return invalid('AMOUNT_NOT_FOUND');
  if (BigInt(transfer.amount) !== BigInt(expectedAmount)) return invalid('AMOUNT_MISMATCH', { expected: expectedAmount, actual: String(transfer.amount) });
  let recipient;
  try { recipient = validateStacksAddress(transfer.recipient, network).address; }
  catch { return invalid('RECIPIENT_NOT_FOUND'); }
  if (recipient !== expectedRecipient) return invalid('RECIPIENT_MISMATCH', { expected: expectedRecipient, actual: recipient });
  return {
    valid: true,
    txid: txid || null,
    network: network.caip2,
    asset: assetId(token, network),
    amount: expectedAmount,
    payer: transfer.payer || transaction.sender_address || null,
    recipient,
    confirmations,
    status: 'success',
    settlement: 'confirmed',
  };
}

function httpFacilitator(url, options = {}) {
  const base = httpUrl(url, 'facilitatorUrl').replace(/\/$/, '');
  const call = async (method, payment, requirements) => {
    validatePaymentPayload(payment);
    validateRequirements(requirements);
    return fetchJson(`${base}/${method}`, {
      ...options,
      method: 'POST',
      headers: { ...(options.facilitatorApiKey ? { 'x-api-key': options.facilitatorApiKey } : {}) },
      body: { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements },
    });
  };
  return {
    verify: (payment, requirements) => call('verify', payment, requirements),
    settle: (payment, requirements) => call('settle', payment, requirements),
  };
}

async function verifyPayment(paymentInput, requirements, options = {}) {
  let payment;
  try {
    payment = typeof paymentInput === 'string' ? decodePayment(paymentInput) : validatePaymentPayload(paymentInput);
    validateRequirements(requirements);
  } catch (error) {
    return invalid('INVALID_PAYMENT', { message: error.message });
  }
  if (!matchesRequirements(payment, requirements)) return invalid('REQUIREMENTS_MISMATCH');
  const transaction = payment.payload.transaction;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(transaction)) {
    try {
      const network = resolveNetwork(requirements.network);
      const requiredToken = requirements.asset === 'STX' ? 'STX' : require('./stacks').tokenForAsset(requirements.asset, network);
      const token = requiredToken;
      if (!token) return invalid('UNSUPPORTED_ASSET');
      return await verifyTransaction({
        ...options,
        txid: transaction,
        network,
        recipient: requirements.payTo,
        amount: requirements.amount,
        token,
      });
    } catch (error) {
      return invalid(error.code || 'TRANSACTION_VERIFICATION_FAILED', { message: error.message });
    }
  }
  const facilitator = options.facilitator || (options.facilitatorUrl ? httpFacilitator(options.facilitatorUrl, options) : null);
  if (!facilitator) return invalid('SIGNED_TRANSACTION_REQUIRES_FACILITATOR');
  try {
    const result = await facilitator.verify(payment, requirements);
    if (!result || result.isValid !== true) return invalid(result?.invalidReason || 'FACILITATOR_REJECTED', { payer: result?.payer });
    return { valid: true, payer: result.payer || null, network: requirements.network, settlement: 'verified', facilitator: result };
  } catch (error) {
    return invalid('FACILITATOR_VERIFY_FAILED', { message: error.message });
  }
}

async function settlePayment(paymentInput, requirements, options = {}) {
  let payment;
  try { payment = typeof paymentInput === 'string' ? decodePayment(paymentInput) : validatePaymentPayload(paymentInput); }
  catch (error) { return { success: false, errorReason: 'INVALID_PAYMENT', message: error.message }; }
  if (!matchesRequirements(payment, requirements)) return { success: false, errorReason: 'REQUIREMENTS_MISMATCH' };
  const facilitator = options.facilitator || (options.facilitatorUrl ? httpFacilitator(options.facilitatorUrl, options) : null);
  if (!facilitator) return { success: false, errorReason: 'FACILITATOR_REQUIRED' };
  try {
    const result = await facilitator.settle(payment, requirements);
    return { ...result, success: result?.success === true };
  } catch (error) {
    return { success: false, errorReason: 'SETTLEMENT_FAILED', message: error.message };
  }
}

module.exports = {
  HEADERS,
  PROTOCOL_VERSION,
  buildPaymentRequirements,
  validateRequirements,
  createPaymentRequired,
  validatePaymentRequired,
  encodePaymentRequired,
  decodePaymentRequired,
  createPaymentPayload,
  createTransactionPayment,
  validatePaymentPayload,
  encodePayment,
  decodePayment,
  matchesRequirements,
  paymentRequiredResponse,
  verifyTransaction,
  httpFacilitator,
  verifyPayment,
  settlePayment,
  fetchJson,
  fetchStacksJson,
};
