// Brand configuration.
// - Logo: a configurable PNG asset (swap src/assets/logo.png to rebrand).
// - Name/motto: authoritative source is the DB `settings` table, fetched at
//   runtime via BrandContext. The VITE_* env values below are only a bootstrap
//   fallback shown before the API responds (or if it's unreachable).
import logo from "@/assets/logo.png";

export const defaultBrand = {
  name: import.meta.env.VITE_BRAND_NAME || "CTRL",
  motto: import.meta.env.VITE_BRAND_MOTTO || "Stay in CTRL.",
};

export const brand = { ...defaultBrand, logo };

export default brand;
