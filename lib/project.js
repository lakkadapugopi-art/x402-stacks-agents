'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defaultConfig, saveConfig } = require('./config');
const { isValidStacksAddress, resolveNetwork } = require('./stacks');
const { ValidationError } = require('./errors');
const { atomicAmount } = require('./validation');

const TEMPLATE_FILES = Object.freeze([
  Object.freeze({ source: 'package.json.tpl', target: 'package.json' }),
  Object.freeze({ source: 'wrangler.jsonc.tpl', target: 'wrangler.jsonc' }),
  Object.freeze({ source: 'README.md.tpl', target: 'README.md' }),
  Object.freeze({ source: '.dev.vars.example', target: '.dev.vars.example' }),
  Object.freeze({ source: 'gitignore.tpl', target: '.gitignore' }),
  Object.freeze({ source: 'src/index.js.tpl', target: 'src/index.js' }),
]);
const GENERATED_PROJECT_FILES = Object.freeze([...TEMPLATE_FILES.map((file) => file.target), '.x402-stacks/config.json']);

function normalizeProjectName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(name) || name.endsWith('-')) {
    throw new ValidationError('Project name must be 2-63 lowercase letters, digits, or internal hyphens', 'name');
  }
  return name;
}

function existingGeneratedFiles(directory) {
  return GENERATED_PROJECT_FILES.map((relative) => path.join(directory, relative)).filter((filename) => fs.existsSync(filename));
}

function createCloudflareAgentProject(options) {
  if (!options || typeof options !== 'object') throw new ValidationError('Project options are required');
  const directory = path.resolve(options.directory || process.cwd());
  const name = normalizeProjectName(options.name || path.basename(directory).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const network = resolveNetwork(options.network || 'testnet');
  const token = options.token || 'sBTC';
  const amount = atomicAmount(options.amount || '100');
  const recipient = options.recipient || '';
  if (recipient && !isValidStacksAddress(recipient, network)) throw new ValidationError(`Recipient must be a valid ${network.name} address`, 'recipient');
  if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0 && !options.force) {
    throw new ValidationError(`Directory is not empty: ${directory}. Use force to review generated-file overwrites.`, 'directory');
  }
  const overwritten = options.force ? existingGeneratedFiles(directory) : [];
  const templateRoot = path.join(__dirname, '..', 'templates', 'cloudflare-agent');
  const replacements = {
    '__PROJECT_NAME__': name,
    '__NETWORK__': network.name,
    '__RECIPIENT__': recipient,
    '__TOKEN__': token,
    '__AMOUNT__': amount,
    '__API_URL__': network.apiUrl,
  };
  const files = [];
  for (const { source, target: relativeTarget } of TEMPLATE_FILES) {
    const sourcePath = path.join(templateRoot, source);
    const target = path.join(directory, relativeTarget);
    let content = fs.readFileSync(sourcePath, 'utf8');
    for (const [key, value] of Object.entries(replacements)) content = content.split(key).join(value);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push(target);
  }
  const config = saveConfig({ ...defaultConfig(network), recipient, token, amount }, directory);
  const warnings = overwritten.map((filename) => `Overwrote generated file: ${filename}`);
  return { directory, name, network: network.name, files, overwritten, warnings, configPath: config.path, config: config.config };
}

module.exports = { GENERATED_PROJECT_FILES, existingGeneratedFiles, createCloudflareAgentProject, normalizeProjectName };
