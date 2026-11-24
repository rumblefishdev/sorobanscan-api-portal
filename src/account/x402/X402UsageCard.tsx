import Box from "@mui/material/Box";

import { UNDERLINED } from "../../prices/dashboard/parts";
import { DashboardCard, NoticeStrip, UsageMeter } from "../../prices/landing/DashboardPanel";
import { RUMBLEFISH_CONTACT } from "../../prices/landing/links";
import type { X402Usage } from "./api";

const TITLE = "Monthly Usage · Mainnet";

/** A date as Prices' usage card writes its reset: day and month, in UTC ("1 December"). */
const dayAndMonth = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** The plan's name as its pill says it: "free" is "Free". */
const planLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The x402 tab's "Monthly Usage · Mainnet": the account's payments on Mainnet this month against
 * its plan's quota, from x402's `details.usage`, or `null` when x402 couldn't read them. Prices'
 * usage card (`UsageFigures`, and the failed state of `UsageCard` in `../prices/PricesTab.tsx`)
 * from the same parts, in x402's words: what is counted is payments, and what refuses past the
 * quota is `/settle`. The facilitator counts in its own database, so there is no reporting delay
 * to state.
 */
export function X402UsageCard({ usage }: { usage: X402Usage | null }) {
  // Prices' "Could not load your usage", without a reason: x402 gives none for the usage alone.
  // An `alert`: the key was read, so this is the page's one failure.
  if (usage === null) {
    return (
      <DashboardCard title={TITLE}>
        <p data-testid="usage-failed" role="alert">
          Could not load your usage.
        </p>
      </DashboardCard>
    );
  }
  const resets = dayAndMonth(usage.resets_at);
  return (
    <DashboardCard title={TITLE} status={{ label: planLabel(usage.plan.name), tone: "muted" }}>
      <UsageMeter
        headline
        used={usage.used}
        limit={usage.limit}
        remaining={usage.remaining}
        resetLabel={`Resets ${resets}`}
        unit="payments"
      />
      {/* `>=`: x402's count can pass the limit, and the strip is most true then. */}
      {usage.used >= usage.limit && (
        <NoticeStrip tone="error">
          <p data-testid="usage-quota-reached">
            Monthly quota reached. Mainnet <strong>/settle</strong> refuses until {resets}.{" "}
            {/* A link here: the x402 tab has no Rate Limit card to carry one, as Prices' has. */}
            <strong>
              <Box component="a" href={RUMBLEFISH_CONTACT} sx={{ ...UNDERLINED, color: "inherit" }}>
                Contact us for a higher limit.
              </Box>
            </strong>
          </p>
        </NoticeStrip>
      )}
    </DashboardCard>
  );
}
