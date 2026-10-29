'use strict';

const { NETWORKS, TOKENS } = require('./constants');
const {
  createPaymentRequired,
  encodePaymentRequired,
  createPaymentPayload,
  encodePayment,
  verifyPayment,
  verifyTransaction,
} = require('./x402');
const { generateWallet, validateStacksAddress, publicKeyToAddress } = require('./stacks');
const { createCloudflareAgentProject } = require('./project');

const networkSchema = { type: 'string', enum: ['mainnet', 'testnet', 'stacks:1', 'stacks:2147483648'] };
const tokenSchema = { type: 'string', enum: TOKENS };
const objectSchema = { type: 'object' };

const TOOLS = [
  {
    name: 'x402_payment_requirements',
    description: 'Create an x402 v2 payment-required document and HTTP header for a Stacks payment.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      required: ['recipient', 'amount', 'resource_url'],
      properties: {
        network: networkSchema, recipient: { type: 'string', minLength: 5, maxLength: 64 },
        amount: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' }, token: tokenSchema,
        resource_url: { type: 'string', minLength: 1, maxLength: 2048 },
        description: { type: 'string', maxLength: 1024 }, mime_type: { type: 'string', maxLength: 128 },
        max_timeout_seconds: { type: 'integer', minimum: 1, maximum: 86400 },
        tokens: { type: 'array', items: tokenSchema, minItems: 1, maxItems: 8 },
      },
    },
    handler: (args) => {
      const required = createPaymentRequired({
        network: args.network, recipient: args.recipient, amount: args.amount, token: args.token,
        resourceUrl: args.resource_url, description: args.description, mimeType: args.mime_type,
        maxTimeoutSeconds: args.max_timeout_seconds, tokens: args.tokens,
      });
      return { paymentRequired: required, paymentRequiredHeader: encodePaymentRequired(required) };
    },
  },
  {
    name: 'x402_payment_encode',
    description: 'Create and base64-encode an x402 v2 payment payload for a transaction id or raw signed transaction.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['requirements', 'transaction'],
      properties: { requirements: objectSchema, transaction: { type: 'string', minLength: 1, maxLength: 1000000 }, extensions: objectSchema },
    },
    handler: (args) => {
      const payment = createPaymentPayload({ requirements: args.requirements, transaction: args.transaction, extensions: args.extensions });
      return { payment, paymentSignature: encodePayment(payment) };
    },
  },
  {
    name: 'x402_payment_verify',
    description: 'Match and verify an x402 payment against exact requirements using a Stacks transaction or facilitator.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['payment', 'requirements'],
      properties: {
        payment: { type: 'string', minLength: 1, maxLength: 1000000 }, requirements: objectSchema,
        transaction: objectSchema, chain_tip_height: { type: 'integer', minimum: 0 },
        api_url: { type: 'string', maxLength: 2048 }, facilitator_url: { type: 'string', maxLength: 2048 },
        min_confirmations: { type: 'integer', minimum: 1, maximum: 10000 },
        memo: { type: 'string', pattern: '^(0x)?[0-9a-fA-F]{0,68}$' },
      },
    },
    handler: (args) => verifyPayment(args.payment, args.requirements, {
      transaction: args.transaction, chainTipHeight: args.chain_tip_height, apiUrl: args.api_url,
      facilitatorUrl: args.facilitator_url, minConfirmations: args.min_confirmations, memo: args.memo,
    }),
  },
  {
    name: 'x402_stacks_transaction_verify',
    description: 'Verify a confirmed STX or SIP-010 transfer, exact amount, recipient, network, and confirmations.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['recipient', 'amount'],
      properties: {
        txid: { type: 'string', pattern: '^(0x)?[0-9a-fA-F]{64}$' }, transaction: objectSchema,
        network: networkSchema, recipient: { type: 'string', minLength: 5, maxLength: 64 },
        amount: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' }, token: tokenSchema,
        chain_tip_height: { type: 'integer', minimum: 0 }, api_url: { type: 'string', maxLength: 2048 },
        min_confirmations: { type: 'integer', minimum: 1, maximum: 10000 },
        memo: { type: 'string', pattern: '^(0x)?[0-9a-fA-F]{0,68}$' },
      },
    },
    handler: (args) => verifyTransaction({
      txid: args.txid, transaction: args.transaction, network: args.network, recipient: args.recipient,
      amount: args.amount, token: args.token, chainTipHeight: args.chain_tip_height,
      apiUrl: args.api_url, minConfirmations: args.min_confirmations, memo: args.memo,
    }),
  },
  {
    name: 'x402_stacks_address_validate',
    description: 'Validate a c32check Stacks address, checksum, type, and optional network.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['address'],
      properties: { address: { type: 'string', minLength: 5, maxLength: 64 }, network: networkSchema },
    },
    handler: (args) => {
      try { return validateStacksAddress(args.address, args.network); }
      catch (error) { return { valid: false, address: args.address, error: error.message }; }
    },
  },
  {
    name: 'x402_stacks_address_from_public_key',
    description: 'Derive a Stacks address from a compressed or uncompressed secp256k1 public key.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['public_key'],
      properties: { public_key: { type: 'string', pattern: '^(02|03|04)[0-9a-fA-F]+$' }, network: networkSchema },
    },
    handler: (args) => ({ network: args.network || 'testnet', publicKey: args.public_key.toLowerCase(), address: publicKeyToAddress(args.public_key, args.network) }),
  },
  {
    name: 'x402_stacks_wallet_generate',
    description: 'Generate a real secp256k1 Stacks wallet. Private material is omitted unless explicitly requested.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { network: networkSchema, include_private_key: { type: 'boolean' } },
    },
    handler: (args) => {
      const wallet = generateWallet(args.network);
      if (!args.include_private_key) delete wallet.privateKey;
      return wallet;
    },
  },
  {
    name: 'x402_project_init',
    description: 'Scaffold a Cloudflare Agents project with a wrangler configuration and Stacks x402 premium route.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        directory: { type: 'string', minLength: 1, maxLength: 4096 }, name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
        network: networkSchema, recipient: { type: 'string', maxLength: 64 }, token: tokenSchema,
        amount: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' }, force: { type: 'boolean' },
      },
    },
    handler: (args, context) => createCloudflareAgentProject({ ...args, directory: args.directory || (context && context.root) || process.cwd() }),
  },
];

module.exports = { TOOLS, NETWORKS };
