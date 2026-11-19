import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { Link as RouterLink } from "react-router";

import { cardBorder } from "../prices/landing/primitives";
import { color, font, radius } from "../prices/theme/tokens";
import { PRODUCT_NAME, PRODUCTS, type Product } from "./products";

/**
 * A tab per API, as the dashboard draws them, for every page that has one view per API: the
 * dashboard, the quick start and the API reference. A tab is open when the build turns its product
 * on (`VITE_PRODUCTS`, `products.ts`); the others are shown, marked "Coming soon", and can't be
 * selected.
 *
 * With `hrefFor` an open tab is a link to that API's page, so a crawler and a reader without
 * scripts can follow it; without, `onSelect` is told which tab was pressed. The ids pair a tab
 * with its panel: `tabId` and `panelId` name them for the page that draws the panel.
 */
export function ProductTabs({
  name,
  selected,
  enabled,
  onSelect,
  hrefFor,
}: {
  /** What tells these tabs' ids from another page's: `dashboard`, `docs`. */
  name: string;
  selected: Product | undefined;
  enabled: readonly Product[];
  onSelect?: (product: Product) => void;
  hrefFor?: (product: Product) => string;
}) {
  return (
    <Tabs
      value={selected ?? false}
      onChange={(_, product: Product) => {
        // A click on a shut tab opens nothing. Tab and the arrow keys don't reach it (MUI gives
        // an unselected tab `tabIndex=-1` and its arrow keys skip `aria-disabled` ones), but a
        // screen reader's browse mode still reads its "Coming soon".
        if (enabled.includes(product)) onSelect?.(product);
      }}
      aria-label="APIs"
      sx={{
        minHeight: 0,
        borderBottom: cardBorder,
        "& .MuiTabs-indicator": { backgroundColor: color.primary[400], height: 2 },
      }}
    >
      {PRODUCTS.map((product) => {
        const open = enabled.includes(product);
        return (
          <Tab
            key={product}
            value={product}
            id={tabId(name, product)}
            {...(open && hrefFor ? { component: RouterLink, to: hrefFor(product) } : {})}
            // Only the selected tab's panel is rendered; the others would point at nothing.
            aria-controls={product === selected ? panelId(name, product) : undefined}
            aria-disabled={open ? undefined : true}
            disableRipple={!open}
            label={
              <Stack component="span" direction="row" spacing={1} alignItems="center">
                <span>{PRODUCT_NAME[product]}</span>
                {!open && <ComingSoon />}
              </Stack>
            }
            sx={{
              minHeight: 44,
              px: 2,
              textTransform: "none",
              fontFamily: font.secondary,
              fontSize: "0.9375rem",
              fontWeight: 500,
              color: color.text.tertiary,
              "&.Mui-selected": { color: color.text.primary },
              ...(!open && { cursor: "default", "&:hover": { color: color.text.tertiary } }),
              ...(open && { "&:hover": { color: color.text.primary } }),
            }}
          />
        );
      })}
    </Tabs>
  );
}

export const tabId = (name: string, product: Product) => `${name}-tab-${product}`;
export const panelId = (name: string, product: Product) => `${name}-panel-${product}`;

/** The shut tab's mark: Prices' muted status pill, as spans, since it sits inside a button. */
function ComingSoon() {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.25,
        borderRadius: `${radius.chip}px`,
        backgroundColor: color.surface.grayAlt,
        color: color.text.tertiary,
        fontSize: "0.75rem",
        fontWeight: 700,
        lineHeight: 1.5,
      }}
    >
      Coming soon
    </Box>
  );
}
