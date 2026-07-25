import { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { defaultBrand } from "@/config/brand";
import logo from "@/assets/logo.png";

const BrandContext = createContext({ ...defaultBrand, logo });

// Fetches brand name/motto from the DB-backed /brand endpoint at runtime.
// Falls back to the env defaults until (or unless) the API responds.
export function BrandProvider({ children }) {
  const [brand, setBrand] = useState({ ...defaultBrand, logo });

  useEffect(() => {
    let alive = true;
    api
      .get("/brand")
      .then(({ data }) => {
        if (!alive) return;
        setBrand({
          name: data.name || defaultBrand.name,
          motto: data.motto || defaultBrand.motto,
          logo,
        });
        document.title = data.name || defaultBrand.name;
      })
      .catch(() => {
        /* keep fallback defaults */
      });
    return () => {
      alive = false;
    };
  }, []);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
