'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_VERSION, TOKENS } = require('./constants');
const { CONFIG_KEYS, loadConfig, setConfigValue, verifyConfig, configPath } = require('./config');
const { generateWallet, validateStacksAddress, publicKeyToAddress, resolveNetwork } = require('./stacks');
const {
  buildPaymentRequirements,
  createPaymentRequired,
  encodePaymentRequired,
  decodePaymentRequired,
  createPaymentPayload,
  encodePayment,
  decodePayment,
  verifyPayment,
  verifyTransaction,
} = require('./x402');
const { createCloudflareAgentProject, existingGeneratedFiles } = require('./project');
const { ValidationError } = require('./errors');

const HELP = `x402-stacks-agents ${PACKAGE_VERSION}

Usage:
  x402-stacks-agents init [directory] [--name NAME] [--network testnet|mainnet]
                       [--recipient ADDRESS] [--token STX|sBTC|USDCx] [--amount N] [--force --yes]
  x402-stacks-agents config show|get|set [key] [value] [--root DIR]
  x402-stacks-agents verify [txid] [--root DIR] [--transaction FILE] [--payment TOKEN]
  x402-stacks-agents payment-required [--resource-url URL] [--header] [--root DIR]
  x402-stacks-agents payment encode|decode|verify [value] [--requirements FILE]
                       [--transaction FILE] [--root DIR] [--signature]
  x402-stacks-agents transaction verify TXID [--transaction FILE] [--root DIR]
  x402-stacks-agents address generate|validate|from-public-key [value]
                       [--network testnet|mainnet] [--public-only]
  x402-stacks-agents mcp-start [--root DIR]
  x402-stacks-agents --version

Global output: add --json for structured JSON. Prices are atomic units.
`;

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') { positional.push(...argv.slice(index + 1)); break; }
    if (!argument.startsWith('--')) { positional.push(argument); continue; }
    const equal = argument.indexOf('=');
    let key = equal >= 0 ? argument.slice(2, equal) : argument.slice(2);
    let value = equal >= 0 ? argument.slice(equal + 1) : undefined;
    if (value === undefined && index + 1 < argv.length && !argv[index + 1].startsWith('--')) value = argv[++index];
    if (value === undefined) value = true;
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    key = key.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    options[key] = value;
  }
  return { positional, options };
}

function allowed(options, names) {
  const common = ['json', 'root', 'network', 'recipient', 'token', 'amount', 'apiUrl'];
  for (const key of Object.keys(options)) {
    if (!common.includes(key) && !names.includes(key)) throw new ValidationError(`Unknown option --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
}

function readJson(filename, label = 'file') {
  if (typeof filename !== 'string') throw new ValidationError(`${label} path is required`);
  try { return JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8')); }
  catch (error) { throw new ValidationError(`Cannot read ${label}: ${error.message}`); }
}

function writeOutput(value, options, raw = false) {
  if (raw) { process.stdout.write(`${value}\n`); return; }
  if (typeof value === 'string' && !options.json) process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, options.json ? 0 : 2)}\n`);
}

function readTransactionForPayment(filename) {
  const document = readJson(filename, 'transaction');
  if (typeof document === 'string') return document;
  if (document && typeof document.tx_id === 'string') return document.tx_id;
  if (document && typeof document.transaction === 'string') return document.transaction;
  throw new ValidationError('Transaction JSON must be a string or contain tx_id or transaction', 'transaction');
}

function configOverrides(options) {
  const result = {};
  for (const key of ['network', 'recipient', 'token', 'amount', 'apiUrl']) if (options[key] !== undefined) result[key] = options[key];
  return result;
}

async function main(argv) {
  const { positional, options } = parseArguments(argv);
  const command = positional[0];
  if (command === '--version' || options.version) { writeOutput(PACKAGE_VERSION, options); return; }
  if (!command || command === 'help' || options.help) { writeOutput(HELP, options); return; }
  const root = path.resolve(options.root || process.cwd());

  if (command === 'init') {
    allowed(options, ['name', 'force', 'yes']);
    if (options.yes && !options.force) throw new ValidationError('--yes requires --force', 'yes');
    const directory = path.resolve(positional[1] || root);
    const pendingOverwrites = options.force ? existingGeneratedFiles(directory) : [];
    if (pendingOverwrites.length > 0 && options.yes !== true) {
      throw new ValidationError(`Refusing to overwrite ${pendingOverwrites.length} generated files without confirmation: ${pendingOverwrites.join(', ')}. Re-run with --force --yes after reviewing them.`);
    }
    if (pendingOverwrites.length > 0) process.stderr.write(`WARNING Overwriting ${pendingOverwrites.length} generated files: ${pendingOverwrites.join(', ')}\n`);
    const result = createCloudflareAgentProject({
      directory,
      name: options.name,
      network: options.network || 'testnet',
      recipient: options.recipient || '',
      token: options.token || 'sBTC',
      amount: options.amount || '100',
      force: options.force === true,
    });
    writeOutput({ created: true, directory: result.directory, name: result.name, files: result.files.map((file) => path.relative(result.directory, file)), overwritten: result.overwritten, warnings: result.warnings, configPath: result.configPath }, options);
    return;
  }

  if (command === 'config') {
    allowed(options, []);
    const action = positional[1] || 'show';
    if (action === 'show') { writeOutput({ path: configPath(root), config: loadConfig(root, configOverrides(options)) }, options); return; }
    if (action === 'get') {
      if (!CONFIG_KEYS.includes(positional[2])) throw new ValidationError(`Allowed keys: ${CONFIG_KEYS.join(', ')}`, 'key');
      writeOutput(loadConfig(root)[positional[2]], options);
      return;
    }
    if (action === 'set') {
      if (!positional[2] || positional[3] === undefined) throw new ValidationError('Usage: config set KEY VALUE');
      writeOutput(setConfigValue(root, positional[2], positional[3]), options);
      return;
    }
    throw new ValidationError('Usage: config show|get|set');
  }

  if (command === 'address') {
    allowed(options, ['publicOnly']);
    const action = positional[1];
    const network = options.network || 'testnet';
    if (action === 'generate') {
      const wallet = generateWallet(network);
      if (options.publicOnly) delete wallet.privateKey;
      writeOutput(wallet, options);
      return;
    }
    if (action === 'validate') { writeOutput(validateStacksAddress(positional[2], options.network), options); return; }
    if (action === 'from-public-key') {
      writeOutput({ network: resolveNetwork(network).name, publicKey: positional[2], address: publicKeyToAddress(positional[2], network) }, options);
      return;
    }
    throw new ValidationError('Usage: address generate|validate|from-public-key');
  }

  if (command === 'payment-required' || command === 'requirements') {
    allowed(options, ['resourceUrl', 'description', 'mimeType', 'maxTimeoutSeconds', 'header']);
    const config = loadConfig(root, configOverrides(options));
    const required = createPaymentRequired({
      ...config,
      resourceUrl: options.resourceUrl || 'x402://premium',
      description: options.description,
      mimeType: options.mimeType,
      maxTimeoutSeconds: options.maxTimeoutSeconds === undefined ? undefined : Number(options.maxTimeoutSeconds),
    });
    if (options.header) writeOutput(encodePaymentRequired(required), options, true);
    else writeOutput({ paymentRequired: required, header: encodePaymentRequired(required) }, options);
    return;
  }

  if (command === 'payment') {
    allowed(options, ['requirements', 'transaction', 'signature', 'payment', 'txid', 'chainTipHeight', 'minConfirmations']);
    const action = positional[1];
    if (action === 'decode') { writeOutput(decodePayment(options.payment || positional[2]), options); return; }
    const config = loadConfig(root, configOverrides(options));
    if (action === 'encode') {
      const requirements = options.requirements ? readJson(options.requirements, 'requirements') : buildPaymentRequirements(config);
      const transaction = options.txid || (options.transaction ? readTransactionForPayment(options.transaction) : positional[2]);
      const payload = createPaymentPayload({ requirements, transaction });
      writeOutput(options.signature ? encodePayment(payload) : { payment: payload, signature: encodePayment(payload) }, options, options.signature === true);
      return;
    }
    if (action === 'verify') {
      const requirements = options.requirements ? readJson(options.requirements, 'requirements') : buildPaymentRequirements(config);
      const result = await verifyPayment(options.payment || positional[2], requirements, {
        ...config,
        transaction: options.transaction ? readJson(options.transaction, 'transaction') : undefined,
        chainTipHeight: options.chainTipHeight === undefined ? undefined : Number(options.chainTipHeight),
        minConfirmations: options.minConfirmations === undefined ? undefined : Number(options.minConfirmations),
      });
      writeOutput(result, options);
      if (!result.valid) process.exitCode = 1;
      return;
    }
    throw new ValidationError('Usage: payment encode|decode|verify');
  }

  if (command === 'transaction' || command === 'verify') {
    allowed(options, ['transaction', 'payment', 'chainTipHeight', 'minConfirmations', 'requirements']);
    const config = loadConfig(root, configOverrides(options));
    let txid = positional[1];
    if (command === 'transaction') {
      if (positional[1] !== 'verify') throw new ValidationError('Usage: transaction verify TXID');
      txid = positional[2];
    }
    if (command === 'verify' && !txid && !options.payment) {
      const result = verifyConfig(root);
      writeOutput(result, options);
      if (!result.valid) process.exitCode = 1;
      return;
    }
    const transaction = options.transaction ? readJson(options.transaction, 'transaction') : undefined;
    const result = options.payment
      ? await verifyPayment(options.payment, options.requirements ? readJson(options.requirements) : buildPaymentRequirements(config), { ...config, transaction, chainTipHeight: options.chainTipHeight === undefined ? undefined : Number(options.chainTipHeight), minConfirmations: options.minConfirmations === undefined ? undefined : Number(options.minConfirmations) })
      : await verifyTransaction({ ...config, txid, transaction, chainTipHeight: options.chainTipHeight === undefined ? undefined : Number(options.chainTipHeight), minConfirmations: options.minConfirmations === undefined ? undefined : Number(options.minConfirmations) });
    writeOutput(result, options);
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (command === 'mcp-start') {
    allowed(options, []);
    const { startServer } = require('../mcp-server');
    startServer({ root });
    return;
  }

  throw new ValidationError(`Unknown command: ${command}. Run with --help for usage.`);
}

module.exports = { main, parseArguments, HELP, TOKENS };
