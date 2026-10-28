# __PROJECT_NAME__

A Cloudflare Agents worker with a Stacks x402 paywall on the `/premium`
route. The `/health` route is free. Payments are verified against confirmed
Stacks transactions; no private key is stored by this template.

## Setup

1. Run `npm install`.
2. Set `PAY_TO` in `wrangler.jsonc` to your __NETWORK__ recipient address.
3. Copy `.dev.vars.example` to `.dev.vars` and add an optional Hiro API key.
4. Run `npm run dev`.

The durable-object route is `/agents/paid-agent/<name>/premium`. A request
without `payment-signature` receives HTTP 402 and a base64 `payment-required`
header. The header contains an exact Stacks payment requirement. After paying,
retry with a base64 x402 payment payload in `payment-signature`. For direct
transaction verification, the payload's `payload.transaction` is the `0x`
transaction id. Confirmed transaction ids are stored in durable-object storage
after first use, and concurrent access is serialized to prevent replay. Raw
signed transactions are rejected by this template until a settlement and
idempotency policy is configured.

## Notes

- Prices are atomic units: sats for sBTC, microSTX for STX, and micro-USDCx.
- One confirmation is required by default.
- `npm run deploy` publishes only when you explicitly run it.
