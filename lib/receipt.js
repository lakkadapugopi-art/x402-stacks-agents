'use strict';

const { PACKAGE_VERSION } = require('./constants');
const { ValidationError } = require('./errors');

const MAX_NOTE_LENGTH = 512;

function buildPaymentReceipt(result, options = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ValidationError('A verification result object is required', 'result');
  }
  if (result.valid !== true) {
    throw new ValidationError('A receipt can only be created for a valid verification result', 'result');
  }
  if (options !== null && typeof options === 'object' && options.note !== undefined && typeof options.note !== 'string') {
    throw new ValidationError('Receipt note must be a string', 'note');
  }
  return {
    receiptVersion: 1,
    generatedAt: new Date().toISOString(),
    package: `x402-stacks-agents@${PACKAGE_VERSION}`,
    outcome: result.settlement || 'verified',
    source: result.facilitator ? 'facilitator' : 'chain',
    txid: result.txid === undefined ? null : result.txid,
    network: result.network === undefined ? null : result.network,
    asset: result.asset === undefined ? null : result.asset,
    amount: result.amount === undefined ? null : String(result.amount),
    memo: result.memo === undefined || result.memo === null ? null : String(result.memo),
    payer: result.payer === undefined || result.payer === null ? null : result.payer,
    recipient: result.recipient === undefined ? null : result.recipient,
    confirmations: result.confirmations === undefined ? null : result.confirmations,
    status: result.status || 'success',
    note: options && typeof options.note === 'string' ? options.note.slice(0, MAX_NOTE_LENGTH) : null,
  };
}

function formatReceiptMarkdown(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new ValidationError('A receipt object is required', 'receipt');
  }
  const rows = [
    ['Receipt version', String(receipt.receiptVersion)],
    ['Generated at', String(receipt.generatedAt)],
    ['Package', String(receipt.package)],
    ['Outcome', String(receipt.outcome)],
    ['Source', String(receipt.source)],
    ['Transaction id', receipt.txid ? String(receipt.txid) : '-'],
    ['Network', String(receipt.network ?? '-')],
    ['Asset', String(receipt.asset ?? '-')],
    ['Amount (atomic units)', String(receipt.amount ?? '-')],
    ['Memo', receipt.memo ? String(receipt.memo) : '-'],
    ['Payer', receipt.payer ? String(receipt.payer) : '-'],
    ['Recipient', String(receipt.recipient ?? '-')],
    ['Confirmations', String(receipt.confirmations ?? '-')],
    ['Status', String(receipt.status ?? '-')],
    ['Note', receipt.note ? String(receipt.note) : '-'],
  ];
  const table = rows.map(([key, value]) => `| ${key} | ${value} |`).join('\n');
  return `# Payment Receipt\n\n| Field | Value |\n|---|---|\n${table}\n`;
}

module.exports = { buildPaymentReceipt, formatReceiptMarkdown };
