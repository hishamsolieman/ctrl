import { useBrand } from "@/context/BrandContext";

// Configurable logo. The image is the asset at src/assets/logo.png; the name &
// motto come from the DB-backed brand config.
export default function Logo({ className = "h-8", withMotto = false }) {
  const brand = useBrand();
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={brand.logo} alt={brand.name} className={className} />
      {withMotto && (
        <span className="text-xs tracking-widest text-muted uppercase">
          {brand.motto}
        </span>
      )}
    </div>
  );
}
