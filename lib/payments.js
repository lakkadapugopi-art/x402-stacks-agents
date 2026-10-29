'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ValidationError } = require('./errors');

const PAYMENTS_DIRECTORY = '.x402-stacks';
const PAYMENTS_FILE = 'payments.jsonl';

function paymentsLedgerPath(root = process.cwd()) {
  return path.join(path.resolve(root), PAYMENTS_DIRECTORY, PAYMENTS_FILE);
}

function recordPayment(root, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ValidationError('Ledger entry must be an object', 'entry');
  }
  if (entry.valid !== true) {
    throw new ValidationError('Only valid verification results can be recorded', 'entry');
  }
  const filename = paymentsLedgerPath(root);
  const previous = listPayments(root);
  if (typeof entry.txid === 'string' && entry.txid) {
    if (previous.some((item) => item.txid === entry.txid)) {
      throw new ValidationError(`Transaction ${entry.txid} is already recorded`, 'entry.txid');
    }
  }
  const record = { ...entry, recordedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.appendFileSync(filename, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return { path: filename, entry: record };
}

function listPayments(root = process.cwd()) {
  const filename = paymentsLedgerPath(root);
  if (!fs.existsSync(filename)) return [];
  return fs.readFileSync(filename, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch { return { parseError: true, line: index + 1 }; }
    });
}

module.exports = { PAYMENTS_FILE, paymentsLedgerPath, recordPayment, listPayments };
