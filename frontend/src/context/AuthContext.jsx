import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { getToken, setToken } from "@/lib/api";
import i18n from "@/i18n";

const AuthContext = createContext(null);

// The user's saved locale (DB) is the source of truth — apply it to the UI.
function applyUserLocale(u) {
  if (u?.locale && u.locale !== i18n.resolvedLanguage) {
    i18n.changeLanguage(u.locale);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTok] = useState(getToken());
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      applyUserLocale(data);
    } catch {
      setToken(null);
      setTok(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Login stores ONLY the token (that's all the backend returns), then
  // resolves the user via the token.
  const login = useCallback(async (username, password) => {
    const { data } = await api.post("/auth/login", { username, password });
    setToken(data.access_token);
    setTok(data.access_token);
    const me = await api.get("/auth/me");
    setUser(me.data);
    applyUserLocale(me.data);
    return me.data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setUser(null);
  }, []);

  // Persist the user's UI language to the DB and apply it immediately.
  const updateLocale = useCallback(async (locale) => {
    i18n.changeLanguage(locale); // instant UI feedback
    const { data } = await api.put("/auth/me/locale", { locale });
    setUser(data);
    return data;
  }, []);

  // Clears must_reset_password on the server and refreshes the local user.
  const changePassword = useCallback(async (password, confirmPassword) => {
    const { data } = await api.post("/auth/change-password", {
      password,
      confirm_password: confirmPassword,
    });
    setUser(data);
    return data;
  }, []);

  const mustResetPassword = !!user?.must_reset_password;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!token,
        mustResetPassword,
        login,
        logout,
        updateLocale,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
