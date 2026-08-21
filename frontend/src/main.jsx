import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadDbTranslations } from "@/i18n";
import { applyTheme } from "@/config/theme";
import { initAutoTitles } from "@/lib/autoTitle";
import { checkDesktopLicense } from "@/lib/license";
import Preloader from "@/components/Preloader";
import LicenseBlocked from "@/components/LicenseBlocked";
import App from "@/App";
import "./index.css";

// Apply theme colors from the root .env before first paint.
applyTheme();

// Show full text on hover for any input/select whose text is clipped.
initAutoTitles();

// A short branded preloader on first boot, then the app.
// Tauri: HWID is checked once here. The browser client skips the lock.
function Root() {
  const [booting, setBooting] = useState(true);
  const [license, setLicense] = useState({ ok: true, hwid: "" });
  useEffect(() => {
    const minDelay = new Promise((r) => setTimeout(r, 900));
    const dbLoad = Promise.race([
      loadDbTranslations(),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    let alive = true;
    Promise.all([minDelay, dbLoad, checkDesktopLicense()]).then(([, , result]) => {
      if (!alive) return;
      setLicense(result);
      setBooting(false);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (booting) return <Preloader />;
  if (!license.ok) return <LicenseBlocked hwid={license.hwid} />;
  return (
    <Suspense fallback={<Preloader />}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
