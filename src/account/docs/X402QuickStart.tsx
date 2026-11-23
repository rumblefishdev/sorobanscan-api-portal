import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Fragment, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import apiReferenceIcon from "../../prices/assets/icons/next-api-reference.svg";
import sourceIcon from "../../prices/assets/icons/next-higher-limits.svg";
import dashboardIcon from "../../prices/assets/icons/next-monitor-usage.svg";
import { panelBorder } from "../../prices/landing/DashboardPanel";
import {
  Code,
  DocCard,
  DocPage,
  DocSection,
  ValueStrip,
} from "../../prices/landing/DocPrimitives";
import { STELLAR_DISCORD_INVITE } from "../../prices/landing/links";
import {
  KEY,
  MUTED,
  NUM,
  STR,
  SnippetTabs,
  Tok,
  Verdict,
  type Snippet,
} from "../../prices/quickstart/QuickStart";
import { color, font, radius } from "../../prices/theme/tokens";

/**
 * The x402 Facilitator's quick start: the Prices quick start's counterpart
 * (`src/prices/quickstart/QuickStart.tsx`), drawn with the same pieces, for a seller who wants to
 * charge per request on Stellar and for an agent reading how the facilitator is called.
 *
 * Everything on it is a still, as on Prices': no request runs from this page. Every fact is the
 * facilitator's own, read from `apps/facilitator/README.md` and `apps/facilitator/openapi.json` of
 * `rumblefishdev/stellar-x402`, and the seller's code is that repo's `examples/http-api`, pointed
 * at this facilitator. The page states no price, no quota and no network as live: `GET /supported`
 * says what an instance serves, and the page says so.
 *
 * The page's shell, its `<title>` and the bar over it are the docs pages', not this component's.
 */

/** The pages this one links to, as routes of the account tree's router (basename `/api`). */
const API_REFERENCE = "/docs/x402";
const DASHBOARD = "/dashboard/x402";
const SIGN_IN = "/login?from=x402";

/** The facilitator's own host, as its OpenAPI document's `servers` block names it. */
export const BASE_URL = "https://x402-facilitator.sorobanscan.com";
const GITHUB = "https://github.com/rumblefishdev/stellar-x402";
const PLACEHOLDER_KEY = "YOUR_API_KEY";
/** Testnet USDC's contract, `USDC_TESTNET_ADDRESS` in `@x402/stellar`. */
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** The sections, in page order. Doubles as the left-hand table of contents. */
export const SECTIONS = [
  { id: "prerequisites", label: "Prerequisites" },
  { id: "base-url", label: "Base URL" },
  { id: "authentication", label: "Authentication" },
  { id: "protect-a-route", label: "Protect a route" },
  { id: "payment-flow", label: "What happens on a request" },
  { id: "by-hand", label: "Calling it by hand" },
  { id: "bazaar", label: "Get listed in the Bazaar" },
  { id: "errors", label: "Error handling" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "next", label: "What's next" },
] as const;

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a snippet's colours are read from: a comment, a string (with the colon that makes it a
 * key), a keyword, a command, a number. Strings come before comments in a line, so a `//` inside a
 * quoted address is never a comment; addresses are always quoted for that reason.
 */
const TOKEN =
  /("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)(\s*:)?|((?<=^|\s)(?:#|\/\/)[^\n]*)|\b(import|from|const|new|await|async)\b|\b(curl|npm)\b|\b(\d+|true|false|null)\b/gm;

/**
 * A snippet's coloured view, derived from its text. Prices authors each snippet twice, as a string
 * and as coloured JSX, and needs a test to keep the two together; here the view is the text cut
 * into runs, so what is on screen is what the Copy button writes. The colours are Prices' five.
 */
function paint(text: string): ReactNode {
  const runs: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, string, colon, comment, keyword, command] = match;
    const start = match.index;
    if (start > at) runs.push(text.slice(at, start));
    if (string !== undefined) {
      runs.push(
        <Tok key={start} c={colon ? KEY : STR}>
          {string}
        </Tok>,
      );
      if (colon) runs.push(colon);
    } else {
      const c = comment !== undefined || command !== undefined ? MUTED : keyword ? KEY : NUM;
      runs.push(
        <Tok key={start} c={c}>
          {whole}
        </Tok>,
      );
    }
    at = start + whole.length;
  }
  if (at < text.length) runs.push(text.slice(at));
  return runs.map((run, i) => (typeof run === "string" ? <Fragment key={`t${i}`}>{run}</Fragment> : run));
}

const snippet = (...lines: string[]): Snippet => {
  const text = lines.join("\n");
  return { text, view: paint(text) };
};
const json = (value: unknown): Snippet => snippet(JSON.stringify(value, null, 2));

/** `GET /supported` on production, 2026-11-19. */
const SUPPORTED_REQUEST = snippet(`curl "${BASE_URL}/supported"`);
const SUPPORTED_RESPONSE = json({
  kinds: [
    {
      x402Version: 2,
      scheme: "exact",
      network: "stellar:testnet",
      extra: { areFeesSponsored: true },
    },
  ],
  extensions: ["bazaar"],
  signers: { "stellar:*": ["GAVE5V5IOMNNBOZXGZSQOP447L2QLCG6ELIIPO6CFJLGZVY4YIK3KKRP"] },
});

/** The packages `examples/http-api` of stellar-x402 depends on for its seller. */
const INSTALL = snippet(
  "npm install express @x402/core @x402/express @x402/extensions @x402/stellar",
);

/**
 * stellar-x402's `examples/http-api/src/app.ts`, in one file and pointed at this facilitator: the
 * same imports, the same registration and the same route, with its Bazaar declaration.
 */
const SELLER = snippet(
  'import express from "express";',
  'import { HTTPFacilitatorClient } from "@x402/core/server";',
  'import { paymentMiddleware, x402ResourceServer } from "@x402/express";',
  'import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";',
  'import { ExactStellarScheme } from "@x402/stellar/exact/server";',
  "",
  "// The Stellar account that is paid.",
  "const payTo = process.env.SELLER_ADDRESS;",
  "",
  `const facilitator = new HTTPFacilitatorClient({ url: "${BASE_URL}" });`,
  "const resourceServer = new x402ResourceServer(facilitator)",
  '  .register("stellar:testnet", new ExactStellarScheme())',
  "  .registerExtension(bazaarResourceServerExtension);",
  "",
  "const app = express();",
  "app.use(",
  "  paymentMiddleware(",
  "    {",
  '      "GET /weather": {',
  '        accepts: { scheme: "exact", price: "$0.001", network: "stellar:testnet", payTo },',
  '        description: "Current temperature for a city",',
  '        mimeType: "application/json",',
  "        extensions: declareDiscoveryExtension({",
  '          input: { city: "Warsaw" },',
  '          inputSchema: { properties: { city: { type: "string" } }, required: ["city"] },',
  '          output: { example: { city: "Warsaw", tempC: 14 } },',
  "        }),",
  "      },",
  "    },",
  "    resourceServer,",
  "  ),",
  ");",
  'app.get("/weather", (req, res) => {',
  "  res.json({ city: req.query.city, tempC: 14 });",
  "});",
  "app.listen(4021);",
);

/** The facilitator README's "API keys on pubnet" snippet, which its own test runs. */
const SELLER_KEY = snippet(
  "const headers = { Authorization: `Bearer ${process.env.X402_FACILITATOR_API_KEY}` };",
  "const facilitator = new HTTPFacilitatorClient({",
  `  url: "${BASE_URL}",`,
  "  createAuthHeaders: async () => ({ verify: headers, settle: headers, supported: headers }),",
  "});",
);

/** `examples/http-api`'s own first check. */
const UNPAID = snippet(
  'curl -i "http://localhost:4021/weather?city=Warsaw"',
  "# 402, with the price in the PAYMENT-REQUIRED header",
);

const REQUIREMENTS = {
  scheme: "exact",
  network: "stellar:testnet",
  amount: "10000",
  asset: USDC_TESTNET,
  payTo: "YOUR_STELLAR_ADDRESS",
  maxTimeoutSeconds: 300,
  extra: { areFeesSponsored: true },
};

/** The body of `/verify` and `/settle`, as the OpenAPI document's `PaymentRequest`. */
const PAYMENT_REQUEST = json({
  x402Version: 2,
  paymentPayload: {
    x402Version: 2,
    accepted: REQUIREMENTS,
    payload: { transaction: "BASE64_XDR_THE_BUYER_SIGNED" },
  },
  paymentRequirements: REQUIREMENTS,
});

const BY_HAND_LANGS = [
  { key: "curl", label: "cURL" },
  { key: "js", label: "JavaScript" },
] as const;
type ByHandLang = (typeof BY_HAND_LANGS)[number]["key"];

const VERIFY: Record<ByHandLang, Snippet> = {
  curl: snippet(
    `curl -X POST "${BASE_URL}/verify" \\`,
    '  -H "Content-Type: application/json" \\',
    "  -d @payment.json",
  ),
  js: snippet(
    "// payment: the body shown under payment.json",
    `const res = await fetch("${BASE_URL}/verify", {`,
    '  method: "POST",',
    '  headers: { "Content-Type": "application/json" },',
    "  body: JSON.stringify(payment),",
    "});",
    "const verdict = await res.json();",
  ),
};
const BY_HAND_TITLE: Record<ByHandLang, string> = { curl: "curl", js: "javascript" };

const VERIFY_VALID = json({ isValid: true, payer: "BUYER_STELLAR_ADDRESS" });
const VERIFY_REFUSED = json({
  isValid: false,
  invalidReason: "invalid_exact_stellar_payto_trustline_missing",
  extra: { expirationLedger: 1234567 },
});
const SETTLE_REQUEST = snippet(
  `curl -X POST "${BASE_URL}/settle" \\`,
  '  -H "Content-Type: application/json" \\',
  "  -d @payment.json",
);
const SETTLED = json({
  success: true,
  transaction: "TRANSACTION_HASH",
  network: "stellar:testnet",
  payer: "BUYER_STELLAR_ADDRESS",
});
const NOT_SENT = json({
  success: false,
  errorReason: "settle_exact_stellar_no_channel_in_time",
  transaction: "",
  network: "stellar:testnet",
  extra: { retryable: true, expirationLedger: 1234567 },
});

const DISCOVERY_REQUEST = snippet(
  `curl "${BASE_URL}/discovery/resources?network=stellar:testnet&limit=20"`,
);
/** One entry as production lists them, with the seller's values in place of a real seller's. */
const DISCOVERY_RESPONSE = json({
  x402Version: 2,
  items: [
    {
      type: "http",
      resource: "https://api.example.com/weather",
      x402Version: 2,
      accepts: [REQUIREMENTS],
      description: "Current temperature for a city",
      mimeType: "application/json",
      lastUpdated: "2026-11-12T15:02:50.313Z",
      extensions: {
        bazaar: {
          info: {
            input: { type: "http", method: "GET", queryParams: { city: "Warsaw" } },
            output: { type: "json", example: { city: "Warsaw", tempC: 14 } },
          },
        },
      },
    },
  ],
  pagination: { limit: 20, offset: 0, total: 1 },
});

const RATE_LIMITED = json({ error: "too_many_requests" });

/**
 * Every snippet on the page, for `X402QuickStart.spec.tsx`: each view must read as its text, and
 * each JSON one must parse.
 */
export const SNIPPETS: Record<string, Snippet> = {
  SUPPORTED_REQUEST,
  INSTALL,
  SELLER,
  SELLER_KEY,
  UNPAID,
  "VERIFY.curl": VERIFY.curl,
  "VERIFY.js": VERIFY.js,
  SETTLE_REQUEST,
  DISCOVERY_REQUEST,
};
export const JSON_SNIPPETS: Record<string, Snippet> = {
  SUPPORTED_RESPONSE,
  PAYMENT_REQUEST,
  VERIFY_VALID,
  VERIFY_REFUSED,
  SETTLED,
  NOT_SENT,
  DISCOVERY_RESPONSE,
  RATE_LIMITED,
};

/** The facilitator's paths this page names, for the spec to hold against the OpenAPI document. */
export const DOCUMENTED_PATHS = [
  "/verify",
  "/settle",
  "/supported",
  "/discovery/resources",
  "/health",
] as const;

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/** Inline code in a sentence, in the cards' monospace. */
const C = ({ children }: { children: ReactNode }) => (
  <Box
    component="code"
    sx={{ fontFamily: font.mono, fontSize: "0.875em", color: color.text.primary }}
  >
    {children}
  </Box>
);

const underlined = { color: "inherit", textDecoration: "underline" } as const;

/** A paragraph under a card or a table, in the guide's quiet body colour. */
const Note = ({ children }: { children: ReactNode }) => (
  <Typography variant="body1" sx={{ color: color.text.tertiary }}>
    {children}
  </Typography>
);

/** A snippet in a card with its Copy button. */
function SnippetCard({ title, snippet: shown }: { title: string; snippet: Snippet }) {
  return (
    <DocCard title={title} copy={{ text: shown.text, label: `${title} example` }}>
      <Code>{shown.view}</Code>
    </DocCard>
  );
}

/**
 * A real table in a card, scrolling inside it at 375 px rather than pushing the page sideways:
 * Prices' "HTTP error codes" table, for any columns.
 */
function TableCard({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  const cell = {
    px: 2,
    py: 1.5,
    textAlign: "left",
    verticalAlign: "top",
    fontFamily: font.secondary,
    fontSize: "0.875rem",
    lineHeight: 1.5,
    borderBottom: panelBorder,
  } as const;
  return (
    <DocCard title={title}>
      <Box sx={{ overflowX: "auto" }}>
        <Box
          component="table"
          sx={{
            width: "100%",
            minWidth: 560,
            borderCollapse: "collapse",
            color: color.text.primary,
            "& th": { ...cell, fontWeight: 500, backgroundColor: color.surface.backgroundAlt },
            "& td": cell,
            "& tr:last-child td": { borderBottom: "none" },
          }}
        >
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((value, j) => (
                  <td key={j}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
    </DocCard>
  );
}

/** A numbered list of steps, each a title and a paragraph: Prices' "Prerequisites" rings. */
function Steps({ steps }: { steps: readonly { title: string; body: ReactNode }[] }) {
  return (
    <Stack component="ol" spacing={3} sx={{ m: 0, p: 0, listStyle: "none" }}>
      {steps.map(({ title, body }, i) => (
        <Stack component="li" key={title} direction="row" spacing={2}>
          {/* `aria-hidden`: it is an `<ol>`, and the list already counts for a screen reader. */}
          <Box
            aria-hidden
            sx={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: `1px solid ${color.primary[400]}`,
              display: "grid",
              placeItems: "center",
              fontFamily: font.mono,
              fontSize: "0.875rem",
              fontWeight: 500,
              color: color.primary[400],
            }}
          >
            {String(i + 1).padStart(2, "0")}
          </Box>
          <Stack spacing={0.75} sx={{ pt: 0.75, minWidth: 0 }}>
            <Typography variant="h5" component="h3" color="text.primary">
              {title}
            </Typography>
            <Typography variant="body1" sx={{ color: color.text.tertiary }}>
              {body}
            </Typography>
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function Prerequisites() {
  return (
    <DocSection
      id="prerequisites"
      title="Prerequisites"
      lede="Three things, and the third only for stellar:pubnet."
    >
      <Steps
        steps={[
          {
            title: "A Stellar account to be paid on",
            body: (
              <>
                Payments go to this address, the <C>payTo</C> of your price. For a classic asset
                such as USDC the account must hold a trustline to it: without one{" "}
                <C>/verify</C> refuses the payment with{" "}
                <C>invalid_exact_stellar_payto_trustline_missing</C>.
              </>
            ),
          },
          {
            title: "A server to protect",
            body: (
              <>
                The facilitator is called by your server, for all of its buyers. <C>/verify</C> and{" "}
                <C>/settle</C> send no CORS headers, so a browser page can&apos;t call them. The
                examples in this guide are Node with Express.
              </>
            ),
          },
          {
            title: "An API key, for stellar:pubnet only",
            body: (
              <>
                A request for <C>stellar:pubnet</C> must carry a key; a request for testnet needs
                none.{" "}
                <Link component={RouterLink} to={SIGN_IN} sx={underlined}>
                  Sign in
                </Link>{" "}
                with a Discord account that is a member of the{" "}
                <Link href={STELLAR_DISCORD_INVITE} target="_blank" rel="noreferrer" sx={underlined}>
                  Stellar Developers Discord
                </Link>
                , then press &quot;Get API Key&quot; on{" "}
                <Link component={RouterLink} to={DASHBOARD} sx={underlined}>
                  your dashboard
                </Link>
                . A Discord account created moments ago is turned away for a short while.
              </>
            ),
          },
        ]}
      />
    </DocSection>
  );
}

function BaseUrl() {
  return (
    <DocSection
      id="base-url"
      title="Base URL"
      lede="Every endpoint is relative to this base URL. GET /supported lists the networks and schemes this instance verifies and settles: read it before you price a route on a network."
    >
      <ValueStrip label="Base URL" value={BASE_URL} copyLabel="base URL" />
      <SnippetCard title="curl" snippet={SUPPORTED_REQUEST} />
      <SnippetCard title="GET /supported — 200 OK" snippet={SUPPORTED_RESPONSE} />
      <Note>
        <C>areFeesSponsored</C> says the facilitator pays the network fee of each settlement, so
        neither the buyer nor the seller needs XLM for it. <C>extensions</C> names what the
        instance understands beside payments: <C>bazaar</C> is the catalog below.
      </Note>
    </DocSection>
  );
}

function Authentication() {
  const header = `Authorization: Bearer ${PLACEHOLDER_KEY}`;
  return (
    <DocSection
      id="authentication"
      title="Authentication"
      lede="Only /verify and /settle take a key, and only for stellar:pubnet. A request for any other network needs none, and its Authorization header is not read. /supported, /discovery/resources and /health never take one."
    >
      <DocCard title="Required header, for stellar:pubnet">
        <Stack spacing={2} sx={{ p: 2 }}>
          <ValueStrip label="Header" value={header} copyLabel="header" />
          <Box
            sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}
          >
            <Verdict tone="ok" label="Correct">
              -H &quot;Authorization: Bearer {PLACEHOLDER_KEY}&quot;
            </Verdict>
            <Verdict tone="bad" label="Wrong — returns 401">
              -H &quot;x-api-key: {PLACEHOLDER_KEY}&quot;
            </Verdict>
          </Box>
        </Stack>
      </DocCard>
      <DocCard title="About the key">
        <Stack component="ul" spacing={1} sx={{ m: 0, p: 2, pl: 4, color: color.text.tertiary }}>
          <Typography component="li" variant="body1">
            A key is <C>x402_</C> followed by 43 characters. An account has one active key at a
            time.
          </Typography>
          <Typography component="li" variant="body1">
            Without an active key the answer is a <C>401</C>, before any check of the payment:{" "}
            <C>missing_api_key</C> with no <C>Authorization</C> header, <C>invalid_api_key</C> for
            another scheme, a malformed key, an unknown key or a revoked one.
          </Typography>
          <Typography component="li" variant="body1">
            A revoked key stops working from the next request. A new key after a revoke can be had
            from the next calendar month (UTC).
          </Typography>
          <Typography component="li" variant="body1">
            The key is a bearer credential: keep it on your server, out of a browser bundle or a
            mobile app.
          </Typography>
        </Stack>
      </DocCard>
    </DocSection>
  );
}

function ProtectARoute() {
  return (
    <DocSection
      id="protect-a-route"
      title="Protect a route"
      lede="The x402 packages do the work: their middleware answers 402 with your price, checks the payment with /verify, runs your handler and settles with /settle. Point their facilitator client at the base URL above."
    >
      <SnippetCard title="install" snippet={INSTALL} />
      <SnippetCard title="javascript" snippet={SELLER} />
      <Note>
        <C>price: &quot;$0.001&quot;</C> on <C>stellar:testnet</C> is 0.001 testnet USDC. The
        payment is verified before your handler runs and settled only after it answers; an error
        status from the handler cancels the settlement, so a request you refuse costs the buyer
        nothing.
      </Note>
      <Stack spacing={2}>
        <Typography variant="h5" component="h3" color="text.primary">
          With an API key
        </Typography>
        <Note>
          For <C>stellar:pubnet</C> the same client sends your key through its{" "}
          <C>createAuthHeaders</C> hook, so the seller changes its configuration, not its code.
          Read the key from the environment.
        </Note>
        <SnippetCard title="javascript" snippet={SELLER_KEY} />
      </Stack>
    </DocSection>
  );
}

function PaymentFlow() {
  return (
    <DocSection
      id="payment-flow"
      title="What happens on a request"
      lede="One paid request, from the buyer's first try to your answer. The middleware makes both facilitator calls; your handler sees only requests that were paid for."
    >
      <Steps
        steps={[
          {
            title: "The buyer asks without a payment",
            body: (
              <>
                Your server answers <C>402</C>. Its <C>PAYMENT-REQUIRED</C> header holds what the
                request costs: the scheme, the network, the asset, the amount and your address.
              </>
            ),
          },
          {
            title: "The buyer signs and asks again",
            body: (
              <>
                Its x402 client signs a payment for exactly that and repeats the request with a{" "}
                <C>PAYMENT-SIGNATURE</C> header. A buyer uses an x402 client that signs Stellar
                payments, such as <C>@x402/fetch</C> with <C>@x402/stellar</C>.
              </>
            ),
          },
          {
            title: "Your server checks the payment",
            body: (
              <>
                The middleware sends the payment and your requirements to <C>POST /verify</C>.
                Nothing reaches the network yet. A payment that fails the check is refused, and
                your handler does not run.
              </>
            ),
          },
          {
            title: "Your handler answers, then the payment settles",
            body: (
              <>
                After your handler answers, the middleware calls <C>POST /settle</C>. The
                facilitator submits the buyer&apos;s signed transfer to Stellar, pays its network
                fee and waits until it is final.
              </>
            ),
          },
          {
            title: "The buyer gets the answer and the receipt",
            body: (
              <>
                Your answer goes out with a <C>PAYMENT-RESPONSE</C> header that holds the
                settlement, the transaction&apos;s hash included.
              </>
            ),
          },
        ]}
      />
      <SnippetCard title="curl" snippet={UNPAID} />
    </DocSection>
  );
}

function ByHand() {
  return (
    <DocSection
      id="by-hand"
      title="Calling it by hand"
      lede="The middleware makes these two calls for you. Make them yourself to test, or from a stack the packages don't cover. Both take the same body, and both always answer 200 when they reached a verdict: read isValid and success, never the status."
    >
      <SnippetCard title="payment.json" snippet={PAYMENT_REQUEST} />
      <Note>
        <C>paymentPayload</C> is what the buyer sent in <C>PAYMENT-SIGNATURE</C>, passed on
        unchanged; <C>paymentRequirements</C> is the price you set. <C>amount</C> is a string of
        digits in the token&apos;s smallest unit: USDC has 7 decimals on Stellar, so{" "}
        <C>10000</C> is 0.001 USDC. A body may be 65,536 bytes at most. For <C>stellar:pubnet</C>{" "}
        add the <C>Authorization</C> header.
      </Note>

      <Stack spacing={2}>
        <Typography variant="h5" component="h3" color="text.primary">
          POST /verify
        </Typography>
        <Note>
          Checks the payment against the requirements and that it would succeed on chain. Nothing
          is sent, and a valid payment can be verified any number of times. A refusal is recorded:
          the same payment never settles through this facilitator afterwards, even once it would
          pass, so the buyer signs a new one once the ledger in <C>extra.expirationLedger</C> has
          closed.
        </Note>
        <SnippetTabs
          id="verify-lang"
          options={BY_HAND_LANGS}
          snippets={VERIFY}
          title={(k) => BY_HAND_TITLE[k]}
        />
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <SnippetCard title="200 — valid" snippet={VERIFY_VALID} />
          <SnippetCard title="200 — refused" snippet={VERIFY_REFUSED} />
        </Box>
        <Note>
          <C>invalidReason</C> is a stable code; <C>invalidMessage</C>, when present, is a
          sentence for a person. A <C>503</C> gives no verdict: <C>rpc_unavailable</C> when no
          Stellar RPC judged the payment, <C>store_unavailable</C> when a refusal could not be
          recorded. The same request may be sent again after <C>Retry-After</C>.
        </Note>
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h5" component="h3" color="text.primary">
          POST /settle
        </Typography>
        <Note>
          Runs the same checks again, submits the transfer and waits for it to be final.{" "}
          <C>success: true</C> is answered once per payment: every later call with the same payment
          gets <C>settle_exact_stellar_already_settled</C>, so one payment unlocks one answer.
        </Note>
        <SnippetCard title="curl" snippet={SETTLE_REQUEST} />
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          <SnippetCard title="200 — settled" snippet={SETTLED} />
          <SnippetCard title="200 — nothing sent" snippet={NOT_SENT} />
        </Box>
        <TableCard
          title="After success: false"
          columns={["The answer has", "It means", "What to do"]}
          rows={[
            [
              <C>errorReason: settlement_pending</C>,
              "Sent and not final yet, or not signed yet.",
              <>
                Send the same request again, or look the hash in <C>transaction</C> up.
              </>,
            ],
            [
              <C>extra.retryable: true</C>,
              "Nothing was sent.",
              <>
                Send the same payment again, as it is, while the network&apos;s latest ledger is at
                most <C>extra.expirationLedger - 2</C>.
              </>,
            ],
            [
              <>
                <C>extra.retryable: false</C> with <C>extra.expirationLedger</C>
              </>,
              "This payment ended.",
              "The buyer signs a new payment only once that ledger has closed. Before it, the first one could still land and charge the buyer twice.",
            ],
            [
              <C>settle_exact_stellar_already_settled</C>,
              "Settled; an earlier call got this payment's success.",
              "Don't serve again for this payment.",
            ],
            [
              <>
                <C>invalid_exact_stellar_*</C>, <C>invalid_network</C>
              </>,
              "The checks refused the payment before anything was sent. The refusal is recorded, so the same payment gets the same answer again.",
              "Fix what the reason names; the buyer signs a new payment once extra.expirationLedger has closed.",
            ],
          ]}
        />
        <Note>
          A <C>503</C> from <C>/settle</C> (<C>no_lease</C> or <C>shutting_down</C>) means nothing
          was read or settled: send the same request again after <C>Retry-After</C>. After a{" "}
          <C>500</C>, send the same request again and never sign a new payment because of it,
          since the first one may still be settling.
        </Note>
      </Stack>
    </DocSection>
  );
}

function Bazaar() {
  return (
    <DocSection
      id="bazaar"
      title="Get listed in the Bazaar"
      lede="The Bazaar is the catalog of paid resources on Stellar. Buyers and AI agents read it to find what they can pay for, and how to call it."
    >
      <Steps
        steps={[
          {
            title: "Describe the route",
            body: (
              <>
                The seller above already does: <C>registerExtension(bazaarResourceServerExtension)</C>{" "}
                on the resource server, and <C>extensions: declareDiscoveryExtension(…)</C> on the
                route, with an example of its input and output. The buyer&apos;s client echoes
                that block in its payment.
              </>
            ),
          },
          {
            title: "Settle one payment",
            body: (
              <>
                A settlement whose payment carries the <C>bazaar</C> extension adds the resource,
                or refreshes its entry. The operator may also seed the catalog from a
                seller&apos;s own <C>402</C> answers, which pass the same checks.
              </>
            ),
          },
          {
            title: "Serve it at a public address",
            body: (
              <>
                Only a resource URL a buyer can reach is listed: <C>https</C> or <C>http</C> with a
                public DNS name. An IP address, <C>localhost</C> or a private name is left out. The
                payment still settles; the <C>EXTENSION-RESPONSES</C> header of{" "}
                <C>/settle</C>&apos;s answer says <C>rejected</C>, with the reason{" "}
                <C>resource_not_public</C>.
              </>
            ),
          },
        ]}
      />
      <Stack spacing={2}>
        <Typography variant="h5" component="h3" color="text.primary">
          Reading the catalog
        </Typography>
        <Note>
          <C>GET /discovery/resources</C> needs no key. Its entries come in a stable order, with no
          ranking.
        </Note>
        <SnippetCard title="curl" snippet={DISCOVERY_REQUEST} />
        <SnippetCard title="GET /discovery/resources — 200 OK" snippet={DISCOVERY_RESPONSE} />
        <Note>
          Beside <C>info</C>, each entry&apos;s <C>bazaar</C> block carries a JSON Schema of the
          input and output, left out above.
        </Note>
        <TableCard
          title="Query parameters"
          columns={["Parameter", "Filters or sets"]}
          rows={[
            [<C>type</C>, "The kind of resource, such as http."],
            [<C>payTo</C>, "The address a resource is paid to: every resource of one seller."],
            [
              <C>network</C>,
              "The network a resource is paid on, as a CAIP-2 id such as stellar:testnet.",
            ],
            [<C>scheme</C>, "The payment scheme. Every entry is exact."],
            [<C>extensions</C>, "The extension an entry carries. Every entry has bazaar."],
            [
              <C>limit</C>,
              "How many entries a page holds: 20 by default, at most 100. A larger value is clamped.",
            ],
            [<C>offset</C>, "How many entries to skip: at most 1,000,000."],
          ]}
        />
        <Note>
          The filters combine. A malformed parameter is a <C>400</C> whose <C>param</C> names it;
          one the route doesn&apos;t know is ignored.
        </Note>
      </Stack>
    </DocSection>
  );
}

function Errors() {
  const again = (
    <>
      Send the same request again after <C>Retry-After</C>.
    </>
  );
  return (
    <DocSection
      id="errors"
      title="Error handling"
      lede='Every answer that is not a 200 has a JSON body with a stable code: {"error": "<code>"}. A refused payment is not one of these: it is a 200 whose body says why.'
    >
      <TableCard
        title="HTTP error codes"
        columns={["Status", "When", "What to do"]}
        rows={[
          [
            <C>400 bad_request</C>,
            "The body is not an x402 version 2 request, or a query parameter of /discovery/resources is malformed.",
            "Fix the request.",
          ],
          [
            <>
              <C>401 missing_api_key</C>
              <br />
              <C>401 invalid_api_key</C>
            </>,
            "A request for stellar:pubnet without an active key.",
            <>
              Send <C>Authorization: Bearer</C> with the key from your dashboard.
            </>,
          ],
          [<C>404 not_found</C>, "A path the facilitator doesn't have.", "Check the path."],
          [
            <C>413 payload_too_large</C>,
            "The body is larger than 65,536 bytes.",
            "Send a smaller body.",
          ],
          [
            <C>429 too_many_requests</C>,
            "The caller is over its budget for the route.",
            <>
              Wait the seconds <C>Retry-After</C> gives.
            </>,
          ],
          [
            <C>500 internal_error</C>,
            "An error of the facilitator's.",
            "Send the same request again. Never sign a new payment because of it.",
          ],
          [
            <C>503 rpc_unavailable</C>,
            "On /verify: no Stellar RPC gave a verdict. The payment was not judged.",
            again,
          ],
          [
            <>
              <C>503 no_lease</C>
              <br />
              <C>503 shutting_down</C>
            </>,
            "On /settle: this instance can't settle right now. Nothing was read or settled.",
            again,
          ],
        ]}
      />
      <Stack spacing={2}>
        <Typography variant="h5" component="h3" color="text.primary">
          429 response body
        </Typography>
        <SnippetCard title="JSON" snippet={RATE_LIMITED} />
      </Stack>
    </DocSection>
  );
}

function RateLimits() {
  const figures = [
    { label: "/verify", value: "600", unit: "req / minute", note: "Per caller" },
    { label: "/settle", value: "600", unit: "req / minute", note: "Per caller" },
    { label: "/discovery", value: "120", unit: "req / minute", note: "Per IP address" },
  ];
  return (
    <DocSection
      id="rate-limits"
      title="Rate limits"
      lede="Each caller has a budget per route and minute. Past it that route answers 429 with Retry-After; the other routes still answer. /supported has no limit."
    >
      <Box
        sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}
      >
        {figures.map(({ label, value, unit, note }) => (
          <Stack
            key={label}
            spacing={1.5}
            sx={{
              p: 2,
              borderRadius: `${radius.lg}px`,
              border: panelBorder,
              backgroundColor: color.surface.grayAlt,
            }}
          >
            <Typography variant="overline" component="p" sx={{ color: color.text.tertiary }}>
              {label}
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              <Typography
                component="span"
                sx={{
                  fontFamily: font.primary,
                  fontWeight: 700,
                  fontSize: "2.25rem",
                  lineHeight: 1,
                  color: color.text.accent,
                }}
              >
                {value}
              </Typography>
              <Typography variant="body1" sx={{ color: color.text.primary }}>
                {unit}
              </Typography>
            </Stack>
            <Typography variant="overline" component="p" sx={{ color: color.text.tertiary }}>
              {note}
            </Typography>
          </Stack>
        ))}
      </Box>
      <Note>
        A caller is its IP address, an IPv6 one counted by its /56. On <C>/verify</C> and{" "}
        <C>/settle</C> for <C>stellar:pubnet</C> it is the API key&apos;s owner instead, wherever
        its requests come from. Your server calls the two for all of its buyers, so the budget is a
        budget per seller. Every request counts, a malformed one too.
      </Note>
    </DocSection>
  );
}

function WhatsNext() {
  const cards: { icon: string; title: string; body: string; to?: string; href?: string }[] = [
    {
      icon: apiReferenceIcon,
      title: "Full API reference",
      body: "Every endpoint, parameter and response schema, from the facilitator's OpenAPI document.",
      to: API_REFERENCE,
    },
    {
      icon: dashboardIcon,
      title: "Your API key",
      body: "Get, show or revoke the key for stellar:pubnet on your dashboard.",
      to: DASHBOARD,
    },
    {
      icon: sourceIcon,
      title: "Source on GitHub",
      body: "The facilitator, its example seller and its documentation are open source.",
      href: GITHUB,
    },
  ];
  return (
    <DocSection
      id="next"
      title="What's next"
      lede="Where to go from a first paid request."
    >
      <Box
        sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}
      >
        {cards.map(({ icon, title, body, to, href }) => {
          const linkProps = to ? { component: RouterLink, to } : { component: "a", href };
          return (
            <Stack
              key={title}
              {...linkProps}
              spacing={1.5}
              sx={{
                p: 2,
                borderRadius: `${radius.lg}px`,
                border: panelBorder,
                backgroundColor: color.surface.grayAlt,
                textDecoration: "none",
                color: "inherit",
                "&:hover": { borderColor: color.primary[400] },
                "&:focus-visible": {
                  outline: `2px solid ${color.stroke.action}`,
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                component="img"
                src={icon}
                alt=""
                aria-hidden
                sx={{ width: 32, height: 32, display: "block" }}
              />
              <Typography variant="h5" component="h3" color="text.primary">
                {title}
              </Typography>
              <Typography variant="body1" sx={{ color: color.text.tertiary }}>
                {body}
              </Typography>
            </Stack>
          );
        })}
      </Box>
    </DocSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export function X402QuickStart() {
  return (
    <DocPage
      sections={SECTIONS}
      title="Take x402 payments on Stellar"
      lede="This guide points a seller's server at the facilitator, puts a price on one route, and shows how to read what /verify and /settle answer. The facilitator pays the network fee of every settlement."
    >
      <Prerequisites />
      <BaseUrl />
      <Authentication />
      <ProtectARoute />
      <PaymentFlow />
      <ByHand />
      <Bazaar />
      <Errors />
      <RateLimits />
      <WhatsNext />
    </DocPage>
  );
}
