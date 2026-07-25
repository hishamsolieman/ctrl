import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadDbTranslations } from "@/i18n";
import { applyTheme } from "@/config/theme";
import Preloader from "@/components/Preloader";
import App from "@/App";
import "./index.css";

// Apply theme colors from the root .env before first paint.
applyTheme();

// A short branded preloader on first boot, then the app.
function Root() {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    // Load UI translations from the DB, but never block the app for long.
    const minDelay = new Promise((r) => setTimeout(r, 900));
    const dbLoad = Promise.race([
      loadDbTranslations(),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    let alive = true;
    Promise.all([minDelay, dbLoad]).then(() => alive && setBooting(false));
    return () => {
      alive = false;
    };
  }, []);
  if (booting) return <Preloader />;
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
