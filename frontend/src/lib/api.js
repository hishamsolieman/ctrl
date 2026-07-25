import axios from "axios";
import i18n from "@/i18n";

export const TOKEN_KEY = "ctrl_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:2830",
});

// Attach the bearer token (used for EVERY action) + current language.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers["Accept-Language"] = i18n.resolvedLanguage || "en";
  return config;
});

// On 401, drop the token so the app redirects to login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) setToken(null);
    return Promise.reject(error);
  }
);

export default api;
