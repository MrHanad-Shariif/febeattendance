import { createContext, useContext, useEffect, useState } from "react";
import client from "../api/client";

const AuthContext = createContext(null);

/** Fine-grained RBAC permissions ("<resource>:<action>") the account holds.
 * Only decides what the UI shows; the API checks every request itself. */
export function permissionsOf(user) {
  return user?.capabilities?.permissions || [];
}

export function hasPermission(user, ...codes) {
  const perms = permissionsOf(user);
  return codes.some((c) => perms.includes(c));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get("/auth/me")
      .then((res) => {
        setUser(res.data);
        localStorage.setItem("user", JSON.stringify(res.data));
      })
      .catch(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  function login(accessToken, userData) {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
  }

  function updateUser(userData) {
    localStorage.setItem("user", JSON.stringify(userData));
    setUser(userData);
  }

  function logout() {
    // Record the sign-out in the system log. Plain fetch (not the axios client)
    // so the token is read before it's cleared below and an expired one can't
    // trigger the client's redirect; never waited on, never fails the logout.
    const token = localStorage.getItem("access_token");
    if (token) {
      fetch(`${client.defaults.baseURL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    setUser(null);
  }

  const can = (...codes) => hasPermission(user, ...codes);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
