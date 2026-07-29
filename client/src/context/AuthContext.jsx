import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStore, onSessionExpired } from "../lib/api";
import { useToast } from "./ToastContext";

const AuthContext = createContext(null);

/**
 * Session state.
 *
 * A stored token is never trusted on its own — on boot it is exchanged for the
 * live user record via `/auth/me`. That way a token for a deleted or
 * deactivated account cannot produce a half-signed-in UI.
 */
export function AuthProvider({ children }) {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | authenticated | anonymous

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tokenStore.get()) {
        setStatus("anonymous");
        return;
      }
      try {
        const { user: me } = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      } catch {
        if (cancelled) return;
        tokenStore.clear();
        setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from anywhere in the app ends the session exactly once.
  useEffect(
    () =>
      onSessionExpired(() => {
        if (!tokenStore.get()) return;
        tokenStore.clear();
        setUser(null);
        setStatus("anonymous");
        toast.warning("Session ended", "Please sign in again to continue.");
      }),
    [toast]
  );

  const adopt = useCallback((payload) => {
    tokenStore.set(payload.token);
    setUser(payload.user);
    setStatus("authenticated");
    return payload.user;
  }, []);

  const login = useCallback(
    async (credentials) => adopt(await api.auth.login(credentials)),
    [adopt]
  );

  const register = useCallback(
    async (payload) => adopt(await api.auth.register(payload)),
    [adopt]
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus("anonymous");
  }, []);

  const refresh = useCallback(async () => {
    const { user: me } = await api.auth.me();
    setUser(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      isLoading: status === "loading",
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
      refresh,
      setUser,
    }),
    [user, status, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
