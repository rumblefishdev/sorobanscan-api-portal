import { Code } from "../components/Code";
import { SectionHead } from "../components/SectionHead";

/** The address a seller's server calls, as the snippet shows it: the facilitator's own host. */
const FACILITATOR_URL = "https://x402-facilitator.sorobanscan.com";

const SELLER = `import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const facilitator = new HTTPFacilitatorClient({
  url: "${FACILITATOR_URL}",
  // Testnet needs no key. Mainnet, when it opens, takes your API key.
});
const server = new x402ResourceServer(facilitator)
  .register("stellar:testnet", new ExactStellarScheme());

const app = express();
app.use(paymentMiddleware({
  "GET /weather": {
    accepts: [{ scheme: "exact", price: "$0.001",
                network: "stellar:testnet", payTo: "G...YOUR_ADDRESS" }],
    description: "Hourly weather forecast for any city",
    // + bazaar extension: listed after the first sale
  },
}, server));`;

const BUYER = `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const signer = createEd25519Signer(
  process.env.STELLAR_SECRET, "stellar:testnet");

const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "stellar:*",
              client: new ExactStellarScheme(signer) }],
});

const res = await pay("https://your-api.example/weather");`;

export function Quickstart() {
  return (
    <section id="quickstart" aria-labelledby="qs-title" className="wrap section">
      <SectionHead badge="Quickstart" id="qs-title" title="Charge for an endpoint in a few lines">
        Point the standard x402 middleware at our facilitator and you are live on testnet, with
        no key. Mainnet comes soon, with the key from your dashboard.
      </SectionHead>
      <div className="code-row">
        <div className="code-card" style={{ flex: "1 1 520px" }}>
          <div className="code-tabs">
            <span className="on">Seller · Express</span>
            <span>server.js</span>
          </div>
          <Code source={SELLER} language="js" mark={[`"${FACILITATOR_URL}"`]} />
        </div>
        <div className="code-card" style={{ flex: "1 1 420px" }}>
          <div className="code-tabs">
            <span className="on">Buyer · Agent</span>
            <span>pay.mjs</span>
          </div>
          <Code source={BUYER} language="js" />
        </div>
      </div>
      <p className="note">
        Works with any x402 v2 client and middleware: Express, Next.js, Hono, fetch. Testnet is free
        and needs no key; on stellar:pubnet, when mainnet opens, your server sends its key to
        /verify and /settle. Buyers need no key.
      </p>
    </section>
  );
}
