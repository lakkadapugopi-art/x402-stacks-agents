// Type definitions for x402-stacks-agents
// Project: https://github.com/lakkadapugopi-art/x402-stacks-agents

export type TokenName = 'STX' | 'sBTC' | 'USDCx';
export type NetworkInput = string | { name: string };

export interface NetworkInfo {
  readonly name: 'mainnet' | 'testnet';
  readonly caip2: string;
  readonly chainId: number;
  readonly addressVersion: number;
  readonly apiUrl: string;
  readonly relayUrl: string;
}

export interface WalletInfo {
  network: string;
  address: string;
  publicKey: string;
  privateKey?: string;
}

export interface AddressInfo {
  valid: true;
  address: string;
  version: number;
  type: 'single-sig' | 'multi-sig';
  network: string;
  hash160: string;
}

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

export interface PaymentResource {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentRequiredDocument {
  x402Version: 2;
  error: string;
  resource: PaymentResource;
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: 2;
  accepted: PaymentRequirements;
  payload: { transaction: string };
  resource?: unknown;
  extensions?: Record<string, unknown>;
}

export interface PaymentVerification {
  valid: boolean;
  reason?: string;
  message?: string;
  txid?: string | null;
  network?: string;
  asset?: string;
  amount?: string;
  memo?: string | null;
  payer?: string | null;
  recipient?: string;
  confirmations?: number;
  status?: string;
  settlement?: string;
  facilitator?: unknown;
  [key: string]: unknown;
}

export interface SettlementResult {
  success: boolean;
  errorReason?: string;
  message?: string;
  transaction?: string;
  network?: string;
  [key: string]: unknown;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  hiroApiKey?: string;
  apiKey?: string;
  facilitatorApiKey?: string;
}

export interface VerifyTransactionOptions {
  network?: NetworkInput;
  token?: string;
  recipient?: string;
  payTo?: string;
  amount: string | number | bigint;
  txid?: string;
  transaction?: Record<string, unknown>;
  apiUrl?: string;
  minConfirmations?: number;
  chainTipHeight?: number;
  memo?: string;
  wait?: boolean;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  hiroApiKey?: string;
  apiKey?: string;
}

export interface VerifyPaymentOptions extends VerifyTransactionOptions {
  facilitator?: Facilitator;
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
}

export interface Facilitator {
  verify(payment: PaymentPayload | string, requirements: PaymentRequirements): Promise<Record<string, unknown>>;
  settle(payment: PaymentPayload | string, requirements: PaymentRequirements): Promise<Record<string, unknown>>;
}

export interface AcceptEntry {
  network?: NetworkInput;
  recipient?: string;
  payTo?: string;
  token?: string;
  amount?: string | number | bigint;
  maxTimeoutSeconds?: number;
}

export interface CreatePaymentRequiredOptions extends AcceptEntry {
  resourceUrl?: string;
  resource?: { url?: string; description?: string; mimeType?: string };
  description?: string;
  mimeType?: string;
  error?: string;
  accepts?: AcceptEntry[];
  tokens?: string[];
}

// lib/constants.js
export declare const NETWORKS: { readonly mainnet: NetworkInfo; readonly testnet: NetworkInfo };
export declare const TOKEN_CONTRACTS: Record<string, Record<string, { address: string; name: string; assetName: string }>>;
export declare const HEADERS: { paymentRequired: string; paymentSignature: string; paymentResponse: string };
export declare const META: Record<string, string>;
export declare const TOKENS: readonly TokenName[];
export declare const PROTOCOL_VERSION: string;
export declare const PACKAGE_VERSION: string;

// lib/stacks.js
export declare const C32: string;
export declare function resolveNetwork(network?: NetworkInput): NetworkInfo;
export declare function normalizeToken(token?: string): TokenName;
export declare function assetId(token: string, network?: NetworkInput): string;
export declare function tokenForAsset(asset: string, network?: NetworkInput): TokenName | undefined;
export declare function c32Address(version: number, hash160: Buffer | string): string;
export declare function validateStacksAddress(address: string, network?: NetworkInput): AddressInfo;
export declare function isValidStacksAddress(address: string, network?: NetworkInput): boolean;
export declare function publicKeyToAddress(publicKey: string, network?: NetworkInput): string;
export declare function privateKeyToAddress(privateKey: string, network?: NetworkInput): string;
export declare function deriveWallet(privateKey: string, network?: NetworkInput): WalletInfo;
export declare function generateWallet(network?: NetworkInput): WalletInfo;
export declare function normalizeTransactionId(txid: string): string;

// lib/x402.js
export declare function buildPaymentRequirements(options: AcceptEntry & { amount: string | number | bigint }): PaymentRequirements;
export declare function validateRequirements(requirements: unknown, path?: string): PaymentRequirements;
export declare function createPaymentRequired(options: CreatePaymentRequiredOptions): PaymentRequiredDocument;
export declare function validatePaymentRequired(required: unknown): PaymentRequiredDocument;
export declare function encodePaymentRequired(required: PaymentRequiredDocument): string;
export declare function decodePaymentRequired(encoded: string): PaymentRequiredDocument;
export declare function createPaymentPayload(options: { requirements: unknown; transaction: string; resource?: unknown; extensions?: Record<string, unknown> }): PaymentPayload;
export declare function createTransactionPayment(requirements: PaymentRequirements, txid: string): PaymentPayload;
export declare function validatePaymentPayload(payment: unknown, path?: string): PaymentPayload;
export declare function encodePayment(payment: PaymentPayload): string;
export declare function decodePayment(encoded: string): PaymentPayload;
export declare function matchesRequirements(payment: unknown, requirements: unknown): boolean;
export declare function paymentRequiredResponse(required: PaymentRequiredDocument, status?: number): Response;
export declare function verifyTransaction(options: VerifyTransactionOptions): Promise<PaymentVerification>;
export declare function httpFacilitator(url: string, options?: FetchOptions): Facilitator;
export declare function verifyPayment(payment: PaymentPayload | string, requirements: unknown, options?: VerifyPaymentOptions): Promise<PaymentVerification>;
export declare function settlePayment(payment: PaymentPayload | string, requirements: unknown, options?: VerifyPaymentOptions): Promise<SettlementResult>;
export declare function fetchJson(url: string, options?: FetchOptions): Promise<unknown>;
export declare function fetchStacksJson(url: string, options?: FetchOptions): Promise<unknown>;

// lib/engine.js
export declare class X402Stacks {
  constructor(config?: Record<string, unknown> & { network?: NetworkInput });
  config: Record<string, unknown>;
  runtime: Record<string, unknown>;
  buildRequirements(options?: Record<string, unknown>): PaymentRequirements;
  createPaymentRequired(options?: CreatePaymentRequiredOptions): PaymentRequiredDocument;
  paymentRequiredResponse(requiredOrOptions?: PaymentRequiredDocument | CreatePaymentRequiredOptions, status?: number): Response;
  verifyTransaction(options?: Partial<VerifyTransactionOptions>): Promise<PaymentVerification>;
  verifyPayment(payment: PaymentPayload | string, requirements?: unknown, options?: Record<string, unknown>): Promise<PaymentVerification>;
  settlePayment(payment: PaymentPayload | string, requirements?: unknown, options?: Record<string, unknown>): Promise<SettlementResult>;
  facilitator(options?: Record<string, unknown>): Facilitator;
}
export interface PaymentGate {
  requirements: PaymentRequirements;
  paymentRequired(reason?: string, extra?: Record<string, unknown>): PaymentRequiredDocument;
  verify(payment: PaymentPayload | string, options?: Record<string, unknown>): Promise<PaymentVerification>;
  settle(payment: PaymentPayload | string, options?: Record<string, unknown>): Promise<SettlementResult>;
}
export declare function createPaymentGate(config: Record<string, unknown>, requirements?: PaymentRequirements | null, resource?: { url?: string; description?: string; mimeType?: string }): PaymentGate;

// lib/project.js
export interface ProjectResult {
  directory: string;
  name: string;
  network: string;
  files: string[];
  overwritten: string[];
  warnings: string[];
  configPath: string;
  config: Record<string, unknown>;
}
export declare const GENERATED_PROJECT_FILES: readonly string[];
export declare function existingGeneratedFiles(directory: string): string[];
export declare function createCloudflareAgentProject(options: Record<string, unknown> & { directory?: string }): ProjectResult;
export declare function normalizeProjectName(name: string): string;

// lib/config.js
export declare const CONFIG_KEYS: readonly string[];
export declare function configPath(root?: string): string;
export declare function defaultConfig(network?: NetworkInput): Record<string, unknown>;
export declare function normalizeConfig(input: Record<string, unknown>, requireRecipient?: boolean): Record<string, unknown>;
export declare function loadConfig(root?: string, overrides?: Record<string, unknown>): Record<string, unknown>;
export declare function saveConfig(config: Record<string, unknown>, root?: string): { path: string; config: Record<string, unknown> };
export declare function setConfigValue(root: string, key: string, value: unknown): { path: string; config: Record<string, unknown> };
export declare function verifyConfig(root?: string): { valid: boolean; checks: Array<{ name: string; ok: boolean; message: string }>; config: Record<string, unknown> | null };

// lib/errors.js
export declare class ValidationError extends Error {
  code: 'VALIDATION_ERROR';
  path?: string;
  constructor(message: string, path?: string);
}
export declare class PaymentError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}

// lib/validation.js
export declare function assertObject<T>(value: T, path?: string): T;
export declare function requiredString(value: unknown, path: string, options?: { minLength?: number; maxLength?: number }): string;
export declare function atomicAmount(value: unknown, path?: string): string;
export declare function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number;
export declare function httpUrl(value: string, path: string, allowX402?: boolean): string;
export declare function validateSchema(value: unknown, schema: Record<string, unknown> | undefined, path?: string): void;

// lib/receipt.js
export interface PaymentReceipt {
  receiptVersion: number;
  generatedAt: string;
  package: string;
  outcome: string;
  source: 'chain' | 'facilitator';
  txid: string | null;
  network: string | null;
  asset: string | null;
  amount: string | null;
  memo: string | null;
  payer: string | null;
  recipient: string | null;
  confirmations: number | null;
  status: string;
  note: string | null;
}
export declare function buildPaymentReceipt(result: PaymentVerification, options?: { note?: string }): PaymentReceipt;
export declare function formatReceiptMarkdown(receipt: PaymentReceipt): string;

// lib/payments.js
export declare const PAYMENTS_FILE: string;
export declare function paymentsLedgerPath(root?: string): string;
export declare function recordPayment(root: string, entry: PaymentVerification & Record<string, unknown>): { path: string; entry: Record<string, unknown> };
export declare function listPayments(root?: string): Array<Record<string, unknown>>;
