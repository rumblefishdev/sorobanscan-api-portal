import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

import { GlyphBadge } from "../prices/dashboard/parts";
import { theme } from "../prices/theme/theme";
import { color, radius } from "../prices/theme/tokens";
import { ISSUE_URL } from "./prices/api";
import type { Product } from "./products";
import type { GetKeyControl } from "./useIssueWindow";

/**
 * "Get API Key", on each tab's key card: a real form, not a `fetch`. The issue is a round trip
 * through Discord, a top-level navigation; the hub reads the product from an urlencoded body only,
 * and refuses a `POST` that doesn't name this page as its origin, which the browser does for a
 * form.
 *
 * The round trip runs in a second window where the browser opens one (`useIssueWindow`, whose
 * `onSubmit` names the window as the form's target): the button is then shut and says it is
 * waiting, in the sign-in page's words for the same wait.
 */
export function GetKeyForm({ product, getKey }: { product: Product; getKey: GetKeyControl }) {
  return (
    <>
      <Box
        component="form"
        method="post"
        action={ISSUE_URL}
        onSubmit={getKey.onSubmit}
        data-testid="get-api-key"
        sx={{ display: "flex", justifyContent: "center" }}
      >
        <input type="hidden" name="product" value={product} />
        {/* Prices' brand button for the card's one action (`data-variant="cta"` there), at its own
            width and centred, as the Prices pages' other primary buttons, not the card's full width
            (akot, 2026-11-18). */}
        <Button
          type="submit"
          variant="contained"
          disabled={getKey.waiting}
          sx={{
            minHeight: 56,
            gap: 1.5,
            borderRadius: `${radius.pill}px`,
            ...theme.typography.body2,
            fontWeight: 700,
            textTransform: "none",
            backgroundColor: color.surface.primary,
            color: color.black,
            boxShadow: "none",
            "&:hover": { backgroundColor: color.primary[300], boxShadow: "none" },
          }}
        >
          <GlyphBadge icon={AddRoundedIcon} tone="onPrimary" />
          {getKey.waiting ? "Waiting for Discord…" : "Get API Key"}
        </Button>
      </Box>
      {getKey.waiting && (
        <p data-testid="issue-waiting" role="status" style={{ textAlign: "center" }}>
          A Discord window opened to check your membership. This page will update automatically.
        </p>
      )}
    </>
  );
}
