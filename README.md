# x402-stacks-agents

Zero-dependency Stacks x402 v2 payment tools for Node.js and Cloudflare
Agents. Includes exact payment requirements, HTTP 402 responses, payment
payload encoding, confirmed STX/SIP-010 transfer verification, real c32check
Stacks wallets, a Cloudflare Agents project generator, a CLI, and an MCP
stdio server.

## Properties

- Node.js 22.5 or newer; built-in cryptography, Fetch API, and Response
- Zero runtime dependencies and zero install scripts
- x402 v2 `payment-required` and `payment-signature` support
- Exact scheme, CAIP-2 network, recipient, asset, and atomic amount matching
- Mainnet and testnet STX, sBTC, and USDCx asset mappings
- On-chain verification through the Hiro API or an offline transaction object
- Confirmation count, transaction status, recipient, amount, and contract checks
- Official c32check address generation and validation; secp256k1 wallet creation
- Cloudflare Agents and wrangler scaffolding with a paid durable-object route
- Eight MCP tools with closed JSON Schemas and JSON-RPC 2.0 notifications
- Entire test suite runs offline

The package verifies payments and creates payment requests. It does not sign
Stacks transactions. A raw signed transaction can be sent to an x402
facilitator through `httpFacilitator`; a transaction id can be verified
directly against chain data.

## Install and verify

    npm install x402-stacks-agents
    npm test
    npm run test:packed

`npm test` runs the offline unit and protocol suites. `npm run test:packed`
performs an actual local npm pack, installs that tarball, and verifies packed
CLI project creation. `npm run test:all` runs both.

## CLI quick start

    x402-stacks-agents init my-agent --name my-agent \
      --network testnet --recipient ST000000000000000000002AMW42H
    x402-stacks-agents config set amount 100 --root my-agent
    x402-stacks-agents verify --root my-agent
    x402-stacks-agents payment-required --root my-agent \
      --resource-url https://example.com/premium

`init` creates `package.json`, `wrangler.jsonc`, `src/index.js`,
`.dev.vars.example`, `.gitignore`, and `.x402-stacks/config.json`. It never
runs package installation or deployment. An existing nonempty directory is
rejected unless `--force` is supplied. When generated files would be overwritten,
the CLI also requires explicit `--yes` confirmation and prints a warning. The
programmatic API returns `overwritten` and `warnings`; unrelated files are
preserved.

### Configuration

    x402-stacks-agents config show --root my-agent
    x402-stacks-agents config set recipient ST000000000000000000002AMW42H --root my-agent
    x402-stacks-agents config set token sBTC --root my-agent
    x402-stacks-agents config set amount 100 --root my-agent

Stored settings are `network`, `recipient`, `token`, `amount`, `apiUrl`,
`maxTimeoutSeconds`, and `minConfirmations`. Amounts are decimal atomic units:
sats for sBTC, microSTX for STX, and micro-USDCx for USDCx.

### Addresses and wallets

    x402-stacks-agents address generate --network testnet --public-only
    x402-stacks-agents address generate --network testnet
    x402-stacks-agents address validate ST000000000000000000002AMW42H
    x402-stacks-agents address from-public-key 0316e35d... --network testnet

Wallet generation uses Node's secp256k1 implementation and produces a real
64-byte private key with the Stacks `01` compression suffix. Private material
is printed only by the explicit full-generation command; `--public-only`
omits it. Protect generated keys and never commit them.

### Payment requests and verification

    x402-stacks-agents payment-required --root my-agent \
      --resource-url https://example.com/premium --header
    x402-stacks-agents payment encode --txid 0xTRANSACTION_ID \
      --root my-agent --signature
    x402-stacks-agents payment verify BASE64_PAYMENT \
      --transaction ./transaction.json --root my-agent
    x402-stacks-agents transaction verify 0xTRANSACTION_ID --root my-agent

Without `--transaction FILE`, transaction verification queries the configured
Hiro API. The JSON fixture form is useful for deterministic testing and uses
the Hiro `extended/v1/tx/{txid}` response shape. A non-success transaction,
wrong network, wrong recipient, wrong amount, wrong token contract, or too few
confirmations is rejected.

## Programmatic API

### Create an HTTP 402 response

    const { X402Stacks } = require('x402-stacks-agents');
    const gateway = new X402Stacks({
      network: 'testnet',
      recipient: 'ST000000000000000000002AMW42H',
      token: 'sBTC',
      amount: '100',
      minConfirmations: 1
    });
    const required = gateway.createPaymentRequired({
      resourceUrl: 'https://example.com/premium',
      description: 'Premium agent response'
    });
    const response = gateway.paymentRequiredResponse(required);

The response has status 402, a JSON body, and a base64 `payment-required`
header. `decodePaymentRequired` and `encodePaymentRequired` are also exported.

### Encode and verify a payment

    const { createTransactionPayment, encodePayment } = require('x402-stacks-agents');
    const requirements = required.accepts[0];
    const payment = createTransactionPayment(requirements, txid);
    const signature = encodePayment(payment);
    const result = await gateway.verifyPayment(signature, requirements);
    if (!result.valid) throw new Error(result.reason);

`verifyPayment` first checks the x402 version and all exact requirement
fields. A 32-byte transaction id is looked up or checked against an injected
transaction object. A raw signed transaction requires `facilitator` or
`facilitatorUrl`.

### Verify a transfer directly

    const result = await gateway.verifyTransaction({ txid });

For STX, the transaction must be a successful `token_transfer`. For sBTC and
USDCx, it must call `transfer` on the network's expected SIP-010 contract with
the exact amount and recipient. Clarity `repr` and hex argument encodings are
supported. A result includes `valid`, and successful results include `txid`,
`payer`, `recipient`, `amount`, `asset`, `network`, and `confirmations`.

### Facilitator

    const { httpFacilitator, settlePayment } = require('x402-stacks-agents');
    const facilitator = httpFacilitator('https://x402-relay.aibtc.dev');
    const verification = await facilitator.verify(payment, requirements);
    const receipt = await settlePayment(payment, requirements, { facilitator });

Facilitator calls use bounded request timeouts and JSON POST bodies. This
package does not claim broadcast transactions are confirmed; direct chain
verification and facilitator settlement are separate results.

### Cloudflare Agents project

    const { createCloudflareAgentProject } = require('x402-stacks-agents');
    createCloudflareAgentProject({
      directory: '/absolute/path/my-agent',
      name: 'my-agent',
      network: 'testnet',
      recipient: 'ST000000000000000000002AMW42H',
      amount: '100'
    });

The generated Worker uses `Agent` and `routeAgentRequest` from Cloudflare's
`agents` package. Its free `/health` route reports readiness and its `/premium`
route requires x402 payment. Confirmed transaction ids are consumed once in
durable-object storage with serialized concurrency, preventing replay. Raw
signed transactions require an explicit settlement and idempotency policy and
are rejected by the default template. The template stores no wallet private key.

## MCP server

    x402-stacks-agents mcp-start

The server speaks newline-delimited JSON-RPC 2.0 over stdio and reserves
stdout for protocol messages. It supports MCP 2025-06-18, 2025-03-26, and
2024-11-05. Notifications receive no response. Latest-protocol batch requests
are rejected; older negotiated versions receive batch arrays.

### Tools

| Tool | Purpose |
|---|---|
| `x402_payment_requirements` | Create a payment-required document and HTTP header |
| `x402_payment_encode` | Create and encode an x402 payment payload |
| `x402_payment_verify` | Match and verify an encoded payment |
| `x402_stacks_transaction_verify` | Verify a confirmed STX or SIP-010 transfer |
| `x402_stacks_address_validate` | Validate c32check checksum, type, and network |
| `x402_stacks_address_from_public_key` | Derive an address from secp256k1 public key |
| `x402_stacks_wallet_generate` | Generate a wallet; private key export is opt-in |
| `x402_project_init` | Create a Cloudflare Agents x402 project |

Malformed arguments and unknown tools return `-32602`. Domain failures return
tool results with `isError: true`. Wallet private keys are omitted unless
`include_private_key: true` is explicitly supplied.

## Environment and network

The CLI configuration defaults to Hiro's public API for the selected network.
Programmatic callers can supply `apiUrl`, `hiroApiKey` (or its backward-
compatible alias `apiKey`), `timeoutMs`, `fetchImpl`, or an offline
`transaction` object. Hiro keys are sent only to Hiro API endpoints. A
facilitator receives a key only when `facilitatorApiKey` is explicitly set;
Hiro keys are never forwarded to it. URLs containing credentials are rejected.
API keys are sent only in the intended service's `x-api-key` header, never in
URLs.

## Security notes

- Payment amounts are arbitrary-precision decimal strings; floating point is
  not used for chain comparisons.
- Address checksums are compared with a timing-safe primitive.
- Configuration writes use an atomic rename and owner-only file permissions.
- No install script, deployment command, or publish command runs implicitly.
- Confirmed chain data and facilitator broadcast receipts are not treated as
  interchangeable settlement states.
