'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { NETWORKS, TOKENS } = require('./constants');
const { resolveNetwork, isValidStacksAddress, normalizeToken } = require('./stacks');
const { ValidationError } = require('./errors');
const { assertObject, atomicAmount, boundedInteger, httpUrl } = require('./validation');

const CONFIG_DIRECTORY = '.x402-stacks';
const CONFIG_FILE = 'config.json';
const CONFIG_KEYS = ['network', 'recipient', 'token', 'amount', 'apiUrl', 'maxTimeoutSeconds', 'minConfirmations'];

function defaultConfig(network = 'testnet') {
  const networkInfo = resolveNetwork(network);
  return {
    network: networkInfo.name,
    recipient: '',
    token: 'sBTC',
    amount: '100',
    apiUrl: networkInfo.apiUrl,
    maxTimeoutSeconds: 300,
    minConfirmations: 1,
  };
}

function configPath(root = process.cwd()) {
  return path.join(path.resolve(root), CONFIG_DIRECTORY, CONFIG_FILE);
}

function normalizeConfig(input, requireRecipient = false) {
  assertObject(input, 'config');
  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.includes(key)) throw new ValidationError('Unknown configuration key', `config.${key}`);
  }
  const networkInfo = resolveNetwork(input.network);
  const output = {
    network: networkInfo.name,
    recipient: input.recipient,
    token: normalizeToken(input.token),
    amount: atomicAmount(input.amount, 'config.amount'),
    apiUrl: httpUrl(input.apiUrl, 'config.apiUrl').replace(/\/$/, ''),
    maxTimeoutSeconds: boundedInteger(input.maxTimeoutSeconds, 'config.maxTimeoutSeconds', 1, 86400),
    minConfirmations: boundedInteger(input.minConfirmations, 'config.minConfirmations', 1, 10000),
  };
  if (typeof output.recipient !== 'string') throw new ValidationError('Expected a string', 'config.recipient');
  if (requireRecipient || output.recipient) {
    if (!isValidStacksAddress(output.recipient, networkInfo)) throw new ValidationError(`Recipient must be a valid ${networkInfo.name} Stacks address`, 'config.recipient');
  } else if (output.recipient.length > 64) {
    throw new ValidationError('Recipient is too long', 'config.recipient');
  }
  return output;
}

function loadConfig(root = process.cwd(), overrides = {}) {
  const filename = configPath(root);
  let stored = {};
  if (fs.existsSync(filename)) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch (error) { throw new ValidationError(`Cannot parse ${filename}: ${error.message}`); }
    assertObject(parsed, 'config');
    stored = parsed;
  }
  const network = overrides.network || stored.network || 'testnet';
  const defaults = defaultConfig(network);
  return normalizeConfig({ ...defaults, ...stored, ...overrides });
}

function saveConfig(config, root = process.cwd()) {
  const normalized = normalizeConfig(config);
  const filename = configPath(root);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
  return { path: filename, config: normalized };
}

function setConfigValue(root, key, value) {
  if (!CONFIG_KEYS.includes(key)) throw new ValidationError(`Allowed keys: ${CONFIG_KEYS.join(', ')}`, 'key');
  const current = loadConfig(root);
  let normalized = value;
  if (['maxTimeoutSeconds', 'minConfirmations'].includes(key)) {
    if (!/^[0-9]+$/.test(String(value))) throw new ValidationError('Expected an integer', key);
    normalized = Number(value);
  }
  if (key === 'network') {
    const nextNetwork = resolveNetwork(value);
    if (!Object.prototype.hasOwnProperty.call(current, 'apiUrl') || current.apiUrl === NETWORKS[current.network].apiUrl) {
      current.apiUrl = nextNetwork.apiUrl;
    }
  }
  return saveConfig({ ...current, [key]: normalized }, root);
}

function verifyConfig(root = process.cwd()) {
  const checks = [];
  let config;
  try {
    config = loadConfig(root);
    checks.push({ name: 'config', ok: true, message: `Configuration loaded from ${configPath(root)}` });
  } catch (error) {
    return { valid: false, checks: [{ name: 'config', ok: false, message: error.message }], config: null };
  }
  const recipientOk = isValidStacksAddress(config.recipient, config.network);
  checks.push({ name: 'recipient', ok: recipientOk, message: recipientOk ? `${config.network} recipient is valid` : 'Set a valid recipient with config set recipient ADDRESS' });
  checks.push({ name: 'amount', ok: true, message: `${config.amount} atomic units of ${config.token}` });
  checks.push({ name: 'networks', ok: NETWORKS[config.network] !== undefined, message: `CAIP-2 ${NETWORKS[config.network].caip2}` });
  return { valid: checks.every((check) => check.ok), checks, config };
}

module.exports = { CONFIG_KEYS, configPath, defaultConfig, normalizeConfig, loadConfig, saveConfig, setConfigValue, verifyConfig };
