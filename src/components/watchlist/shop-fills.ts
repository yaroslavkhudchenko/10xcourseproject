import type { PricedShop } from "@/lib/services/price-comparison";

// Each priced shop's colour (global.css's --shop-* tokens), in one place for the dot on its card and its marker on the
// price track. The classes are written out whole, so Tailwind finds them. The price island draws with them, so this
// module imports nothing server-only.

export const SHOP_FILLS: Record<PricedShop, string> = {
  rossmann: "bg-shop-rossmann",
  natura: "bg-shop-natura",
  hebe: "bg-shop-hebe",
  "super-pharm": "bg-shop-super-pharm",
};
