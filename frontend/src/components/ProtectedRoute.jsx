import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import Preloader from "@/components/Preloader";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, mustResetPassword } = useAuth();
  const location = useLocation();

  if (loading) return <Preloader />;
  if (!isAuthenticated)
    return <Navigate to="/login" replace state={{ from: location }} />;
  // Forced password change blocks every app page until completed.
  if (mustResetPassword)
    return <Navigate to="/reset-password" replace />;
  return children;
}
