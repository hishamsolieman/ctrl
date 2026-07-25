import brand from "@/config/brand";

// Full-screen preloader shown during initial load / auth checks.
export default function Preloader({ message }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-bg">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-border" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin-slow" />
        <img src={brand.logo} alt={brand.name} className="h-6 animate-pulse-accent" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium tracking-widest text-muted uppercase">
          {message || brand.motto}
        </p>
      </div>
    </div>
  );
}
