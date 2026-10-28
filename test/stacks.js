'use strict';
const assert = require('node:assert/strict');
const {
  c32Address, validateStacksAddress, isValidStacksAddress, privateKeyToAddress,
  publicKeyToAddress, generateWallet, resolveNetwork, assetId, tokenForAsset,
} = require('../lib/stacks');

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
}
const PRIVATE = '73a2f291df5a8ce3ceb668a25ac7af45639513af7596d710ddf59f64f484fd2801';
const PUBLIC = '0316e35d38b52d4886e40065e4952a49535ce914e02294be58e252d1998f129b19';
const MAIN = 'SP10J81WVGVB3M4PHQN4Q4G0R8586TBJH948RESDR';
const TEST = 'ST10J81WVGVB3M4PHQN4Q4G0R8586TBJH94CGRESQ';

check('mainnet zero hash official vector', () => assert.equal(c32Address(22, '00'.repeat(20)), 'SP000000000000000000002Q6VF78'));
check('testnet zero hash official vector', () => assert.equal(c32Address(26, '00'.repeat(20)), 'ST000000000000000000002AMW42H'));
check('mainnet private key official vector', () => assert.equal(privateKeyToAddress(PRIVATE, 'mainnet'), MAIN));
check('testnet private key official vector', () => assert.equal(privateKeyToAddress(PRIVATE, 'testnet'), TEST));
check('mainnet public key official vector', () => assert.equal(publicKeyToAddress(PUBLIC, 'mainnet'), MAIN));
check('testnet public key official vector', () => assert.equal(publicKeyToAddress(PUBLIC, 'testnet'), TEST));
check('address parser returns hash and type', () => {
  const parsed = validateStacksAddress(MAIN);
  assert.equal(parsed.version, 22); assert.equal(parsed.type, 'single-sig'); assert.equal(parsed.network, 'mainnet');
});
check('address network mismatch is rejected', () => assert.throws(() => validateStacksAddress(MAIN, 'testnet'), /belongs to mainnet/));
check('address checksum mismatch is rejected', () => assert.equal(isValidStacksAddress(`${MAIN.slice(0, -1)}8`), false));
check('address normalization accepts lowercase', () => assert.equal(validateStacksAddress(TEST.toLowerCase()).address, TEST));
check('generated mainnet wallet is real and valid', () => {
  const wallet = generateWallet('mainnet');
  assert.match(wallet.privateKey, /^[0-9a-f]{66}$/); assert.match(wallet.publicKey, /^(02|03)[0-9a-f]{64}$/);
  assert.equal(validateStacksAddress(wallet.address, 'mainnet').valid, true);
  assert.equal(privateKeyToAddress(wallet.privateKey, 'mainnet'), wallet.address);
});
check('generated testnet wallet is reproducible from private key', () => {
  const wallet = generateWallet('testnet'); assert.equal(privateKeyToAddress(wallet.privateKey, 'testnet'), wallet.address);
});
check('zero private key is rejected', () => assert.throws(() => privateKeyToAddress('00'.repeat(32)), /scalar range/));
check('malformed public key is rejected', () => assert.throws(() => publicKeyToAddress('02abcd'), /Public key/));
check('CAIP-2 aliases resolve', () => { assert.equal(resolveNetwork('stacks:1').name, 'mainnet'); assert.equal(resolveNetwork('stacks:2147483648').name, 'testnet'); });
check('token asset mapping round trip', () => { assert.equal(tokenForAsset(assetId('sBTC', 'testnet'), 'testnet'), 'sBTC'); assert.equal(assetId('STX'), 'STX'); });

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.error ? `: ${item.error}` : ''}`);
console.log(`RESULT ${checks.filter((item) => item.ok).length}/${checks.length} checks passed`);
if (checks.some((item) => !item.ok)) process.exitCode = 1;
