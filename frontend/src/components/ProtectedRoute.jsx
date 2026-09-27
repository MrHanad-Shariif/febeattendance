import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { hasPermission, useAuth } from "../context/AuthContext.jsx";

// requireFace: students who haven't registered a face yet are sent to
// /enroll-face first (and brought back afterwards).
// perms: the page needs at least one of these RBAC permissions.
export default function ProtectedRoute({ children, roles, perms, requireFace = true }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Keep the query string: a scanned class QR code carries its session in ?s=.
  const from = location.pathname + location.search;

  if (!user) {
    return <Navigate to="/login" replace state={{ from }} />;
  }

  if (requireFace && user.role === "student" && user.face_enrolled === false) {
    return <Navigate to="/enroll-face" replace state={{ from }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (perms && !hasPermission(user, ...perms)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
