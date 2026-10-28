import { Agent, routeAgentRequest } from "agents";
import { X402Stacks } from "x402-stacks-agents";

export class PaidAgent extends Agent {
  async onRequest(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/health")) {
      return Response.json({ ok: true, agent: this.name, network: this.env.STACKS_NETWORK });
    }
    if (!url.pathname.endsWith("/premium")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const gateway = new X402Stacks({
      network: this.env.STACKS_NETWORK,
      recipient: this.env.PAY_TO,
      token: this.env.X402_TOKEN,
      amount: this.env.X402_AMOUNT,
      apiUrl: this.env.STACKS_API_URL,
      apiKey: this.env.HIRO_API_KEY || undefined
    });
    const required = gateway.createPaymentRequired({
      resourceUrl: url.toString(),
      description: "Premium Cloudflare Agent response"
    });
    const signature = request.headers.get("payment-signature");
    if (!signature) return gateway.paymentRequiredResponse(required);

    const verification = await gateway.verifyPayment(signature, required.accepts[0]);
    if (!verification.valid) {
      return gateway.paymentRequiredResponse({ ...required, error: verification.reason });
    }
    if (!verification.txid) {
      return gateway.paymentRequiredResponse({ ...required, error: "TXID_REQUIRED_FOR_REPLAY_PROTECTION" });
    }
    const firstUse = await this.ctx.blockConcurrencyWhile(async () => {
      const replayKey = `x402:used:${verification.txid}`;
      if (await this.ctx.storage.get(replayKey)) return false;
      await this.ctx.storage.put(replayKey, {
        payer: verification.payer,
        amount: verification.amount,
        asset: verification.asset,
        usedAt: new Date().toISOString()
      });
      return true;
    });
    if (!firstUse) {
      return gateway.paymentRequiredResponse({ ...required, error: "PAYMENT_REPLAYED" });
    }
    return Response.json({
      message: "Payment verified. The premium agent response is unlocked.",
      payment: verification
    });
  }
}

export default {
  async fetch(request, env) {
    return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
  }
};
