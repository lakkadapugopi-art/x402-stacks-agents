'use strict';

const { CONFIG_KEYS, defaultConfig, normalizeConfig } = require('./config');
const { resolveNetwork } = require('./stacks');
const {
  buildPaymentRequirements,
  createPaymentRequired,
  paymentRequiredResponse,
  verifyPayment,
  verifyTransaction,
  settlePayment,
  httpFacilitator,
} = require('./x402');

class X402Stacks {
  constructor(config = {}) {
    const defaults = defaultConfig(config.network || 'testnet');
    const persisted = Object.fromEntries(CONFIG_KEYS.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
    this.config = normalizeConfig({ ...defaults, ...persisted });
    this.runtime = { ...config };
  }

  buildRequirements(options = {}) {
    return buildPaymentRequirements({ ...this.config, ...this.runtime, ...options });
  }

  createPaymentRequired(options = {}) {
    return createPaymentRequired({ ...this.config, ...this.runtime, ...options });
  }

  paymentRequiredResponse(requiredOrOptions = {}, status = 402) {
    const required = requiredOrOptions.x402Version === 2 ? requiredOrOptions : this.createPaymentRequired(requiredOrOptions);
    return paymentRequiredResponse(required, status);
  }

  async verifyTransaction(options = {}) {
    return verifyTransaction({ ...this.config, ...this.runtime, ...options });
  }

  async verifyPayment(payment, requirements = this.buildRequirements(), options = {}) {
    return verifyPayment(payment, requirements, { ...this.config, ...this.runtime, ...options });
  }

  async settlePayment(payment, requirements = this.buildRequirements(), options = {}) {
    const merged = { ...this.config, ...this.runtime, ...options };
    if (!merged.facilitator && !merged.facilitatorUrl) merged.facilitatorUrl = resolveNetwork(merged.network).relayUrl;
    return settlePayment(payment, requirements, merged);
  }

  facilitator(options = {}) {
    return httpFacilitator(options.url || resolveNetwork(this.config.network).relayUrl, { ...this.config, ...this.runtime, ...options });
  }
}

function createPaymentGate(config, requirements, resource) {
  const engine = new X402Stacks(config);
  const resolvedRequirements = requirements || engine.buildRequirements();
  return {
    requirements: resolvedRequirements,
    paymentRequired(reason = 'PAYMENT_REQUIRED', extra = {}) {
      return {
        ...engine.createPaymentRequired({
          resourceUrl: resource?.url || 'x402://payment',
          description: resource?.description,
          mimeType: resource?.mimeType,
          error: reason,
        }),
        ...extra,
      };
    },
    verify: (payment, options = {}) => engine.verifyPayment(payment, resolvedRequirements, options),
    settle: (payment, options = {}) => engine.settlePayment(payment, resolvedRequirements, options),
  };
}

module.exports = { X402Stacks, createPaymentGate };
