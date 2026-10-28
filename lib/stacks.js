'use strict';

const crypto = require('node:crypto');
const { NETWORKS, TOKEN_CONTRACTS, TOKENS } = require('./constants');
const { ValidationError } = require('./errors');

const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECP256K1_ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0340360');
const VERSION_NETWORKS = Object.freeze({ 20: 'mainnet', 22: 'mainnet', 21: 'testnet', 26: 'testnet' });
const VERSION_TYPES = Object.freeze({ 20: 'multi-sig', 21: 'multi-sig', 22: 'single-sig', 26: 'single-sig' });

function resolveNetwork(network = 'testnet') {
  if (network && typeof network === 'object' && NETWORKS[network.name]) return NETWORKS[network.name];
  if (typeof network !== 'string') throw new ValidationError('Network must be a string', 'network');
  const value = network.toLowerCase();
  const name = value === 'mainnet' || value === 'stacks:1' || value === '1'
    ? 'mainnet'
    : value === 'testnet' || value === 'stacks:2147483648' || value === '2147483648'
      ? 'testnet'
      : null;
  if (!name) throw new ValidationError(`Unsupported Stacks network: ${network}`, 'network');
  return NETWORKS[name];
}

function normalizeToken(token = 'sBTC') {
  if (!TOKENS.includes(token)) throw new ValidationError(`Token must be one of ${TOKENS.join(', ')}`, 'token');
  return token;
}

function assetId(token, network = 'testnet') {
  const normalized = normalizeToken(token);
  const networkInfo = resolveNetwork(network);
  if (normalized === 'STX') return 'STX';
  const contract = TOKEN_CONTRACTS[networkInfo.name][normalized];
  return `${contract.address}.${contract.name}`;
}

function tokenForAsset(asset, network = 'testnet') {
  if (typeof asset !== 'string') return undefined;
  return TOKENS.find((token) => assetId(token, network) === asset);
}

function doubleSha256(data) {
  return crypto.createHash('sha256').update(crypto.createHash('sha256').update(data).digest()).digest();
}

function c32Normalize(value) {
  return value.toUpperCase().replace(/O/g, '0').replace(/[LI]/g, '1');
}

function c32Encode(data) {
  const bytes = Buffer.from(data);
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  let value = bytes.length ? BigInt(`0x${bytes.toString('hex')}`) : 0n;
  let encoded = '';
  while (value > 0n) {
    encoded = C32[Number(value % 32n)] + encoded;
    value /= 32n;
  }
  return '0'.repeat(leadingZeroes) + encoded;
}

function c32Decode(value) {
  if (typeof value !== 'string') throw new ValidationError('c32 value must be a string');
  const normalized = c32Normalize(value);
  if (!new RegExp(`^[${C32}]*$`).test(normalized)) throw new ValidationError('Invalid c32 character');
  let leadingZeroes = 0;
  while (leadingZeroes < normalized.length && normalized[leadingZeroes] === '0') leadingZeroes += 1;
  let number = 0n;
  for (const character of normalized) number = number * 32n + BigInt(C32.indexOf(character));
  let hex = number.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const body = number === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
}

function c32Address(version, hash160) {
  if (!Number.isInteger(version) || version < 0 || version >= 32) throw new ValidationError('Address version must be between 0 and 31');
  const data = Buffer.isBuffer(hash160) ? hash160 : Buffer.from(String(hash160).replace(/^0x/, ''), 'hex');
  if (data.length !== 20) throw new ValidationError('hash160 must contain exactly 20 bytes', 'hash160');
  const payload = Buffer.concat([Buffer.from([version]), data]);
  const checksum = doubleSha256(payload).subarray(0, 4);
  return `S${C32[version]}${c32Encode(Buffer.concat([data, checksum]))}`;
}

function validateStacksAddress(address, network) {
  if (typeof address !== 'string') throw new ValidationError('Address must be a string', 'address');
  if (address.length <= 5 || address.length > 64 || !address.toUpperCase().startsWith('S')) {
    throw new ValidationError('Invalid c32 address format', 'address');
  }
  const normalized = c32Normalize(address.slice(1));
  const version = C32.indexOf(normalized[0]);
  if (version < 0 || VERSION_NETWORKS[version] === undefined) throw new ValidationError('Unsupported c32 address version', 'address');
  const decoded = c32Decode(normalized.slice(1));
  if (decoded.length !== 24) throw new ValidationError('Invalid c32 address payload length', 'address');
  const hash160 = decoded.subarray(0, 20);
  const expected = doubleSha256(Buffer.concat([Buffer.from([version]), hash160])).subarray(0, 4);
  const actual = decoded.subarray(20);
  if (!crypto.timingSafeEqual(actual, expected)) throw new ValidationError('Invalid c32 address checksum', 'address');
  const detectedNetwork = VERSION_NETWORKS[version];
  if (network !== undefined && resolveNetwork(network).name !== detectedNetwork) {
    throw new ValidationError(`Address belongs to ${detectedNetwork}, not ${resolveNetwork(network).name}`, 'address');
  }
  return {
    valid: true,
    address: c32Address(version, hash160),
    version,
    type: VERSION_TYPES[version],
    network: detectedNetwork,
    hash160: hash160.toString('hex'),
  };
}

function isValidStacksAddress(address, network) {
  try {
    validateStacksAddress(address, network);
    return true;
  } catch {
    return false;
  }
}

function normalizePublicKey(publicKey) {
  if (typeof publicKey !== 'string' || !/^(02|03)[0-9a-fA-F]{64}$/.test(publicKey) && !/^04[0-9a-fA-F]{128}$/.test(publicKey)) {
    throw new ValidationError('Public key must be a 33-byte compressed or 65-byte uncompressed secp256k1 key', 'publicKey');
  }
  return publicKey.toLowerCase();
}

function publicKeyToAddress(publicKey, network = 'testnet') {
  const key = normalizePublicKey(publicKey);
  const networkInfo = resolveNetwork(network);
  const hash160 = crypto.createHash('ripemd160').update(crypto.createHash('sha256').update(Buffer.from(key, 'hex')).digest()).digest();
  return c32Address(networkInfo.addressVersion, hash160);
}

function normalizePrivateKey(privateKey) {
  if (typeof privateKey !== 'string') throw new ValidationError('Private key must be a hexadecimal string', 'privateKey');
  const value = privateKey.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}(01)?$/.test(value)) throw new ValidationError('Private key must be 32 bytes with an optional 01 compression suffix', 'privateKey');
  const scalar = BigInt(`0x${value.slice(0, 64)}`);
  if (scalar <= 0n || scalar >= SECP256K1_ORDER) throw new ValidationError('Private key is outside the secp256k1 scalar range', 'privateKey');
  return `${value.slice(0, 64)}01`;
}

function deriveWallet(privateKey, network = 'testnet') {
  const normalized = normalizePrivateKey(privateKey);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(normalized.slice(0, 64), 'hex'));
  const publicKey = ecdh.getPublicKey(null, 'compressed').toString('hex');
  const networkInfo = resolveNetwork(network);
  return {
    network: networkInfo.name,
    address: publicKeyToAddress(publicKey, networkInfo),
    publicKey,
    privateKey: normalized,
  };
}

function privateKeyToAddress(privateKey, network = 'testnet') {
  return deriveWallet(privateKey, network).address;
}

function generateWallet(network = 'testnet') {
  for (;;) {
    const candidate = crypto.randomBytes(32).toString('hex');
    const scalar = BigInt(`0x${candidate}`);
    if (scalar > 0n && scalar < SECP256K1_ORDER) return deriveWallet(candidate, network);
  }
}

function normalizeTransactionId(txid) {
  if (typeof txid !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(txid)) {
    throw new ValidationError('Transaction id must be exactly 32 bytes of hexadecimal', 'txid');
  }
  return `0x${txid.replace(/^0x/, '').toLowerCase()}`;
}

module.exports = {
  C32,
  resolveNetwork,
  normalizeToken,
  assetId,
  tokenForAsset,
  c32Address,
  validateStacksAddress,
  isValidStacksAddress,
  publicKeyToAddress,
  privateKeyToAddress,
  deriveWallet,
  generateWallet,
  normalizeTransactionId,
};
