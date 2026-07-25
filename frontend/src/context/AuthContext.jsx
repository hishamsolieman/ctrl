import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { getToken, setToken } from "@/lib/api";

const AuthContext = createContext(null);

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
    return me.data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTok(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, token, loading, isAuthenticated: !!token, login, logout }}
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
