'use strict';

const NETWORKS = Object.freeze({
  mainnet: Object.freeze({
    name: 'mainnet',
    caip2: 'stacks:1',
    chainId: 1,
    addressVersion: 22,
    apiUrl: 'https://api.mainnet.hiro.so',
    relayUrl: 'https://x402-relay.aibtc.com',
  }),
  testnet: Object.freeze({
    name: 'testnet',
    caip2: 'stacks:2147483648',
    chainId: 2147483648,
    addressVersion: 26,
    apiUrl: 'https://api.testnet.hiro.so',
    relayUrl: 'https://x402-relay.aibtc.dev',
  }),
});

const TOKEN_CONTRACTS = Object.freeze({
  mainnet: Object.freeze({
    sBTC: Object.freeze({ address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4', name: 'sbtc-token', assetName: 'sbtc-token' }),
    USDCx: Object.freeze({ address: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE', name: 'usdcx', assetName: 'usdcx-token' }),
  }),
  testnet: Object.freeze({
    sBTC: Object.freeze({ address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', name: 'sbtc-token', assetName: 'sbtc-token' }),
    USDCx: Object.freeze({ address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', name: 'usdcx', assetName: 'usdcx-token' }),
  }),
});

const HEADERS = Object.freeze({
  paymentRequired: 'payment-required',
  paymentSignature: 'payment-signature',
  paymentResponse: 'payment-response',
});

const META = Object.freeze({
  paymentRequired: 'agents-x402/paymentRequired',
  price: 'agents-x402-stacks/price',
  error: 'x402/error',
  payment: 'x402/payment',
  paymentResponse: 'x402/payment-response',
});

const TOKENS = Object.freeze(['STX', 'sBTC', 'USDCx']);
const PROTOCOL_VERSION = '2025-06-18';
const PACKAGE_VERSION = require('../package.json').version;

module.exports = { NETWORKS, TOKEN_CONTRACTS, HEADERS, META, TOKENS, PROTOCOL_VERSION, PACKAGE_VERSION };
