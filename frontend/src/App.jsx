import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BrandProvider } from "@/context/BrandContext";
import { ToastProvider } from "@/context/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Products from "@/pages/Products";
import ProductCategories from "@/pages/ProductCategories";
import ProductAttributes from "@/pages/ProductAttributes";
import Preloader from "@/components/Preloader";

// Redirect authenticated users away from /login.
function LoginRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <Preloader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Login />;
}

export default function App() {
  return (
    <ToastProvider>
      <BrandProvider>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/products" element={<Navigate to="/products/list" replace />} />
            <Route path="/products/list" element={<Products />} />
            <Route path="/products/categories" element={<ProductCategories />} />
            <Route path="/products/attributes" element={<ProductAttributes />} />
          </Route>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </BrowserRouter>
        </AuthProvider>
      </BrandProvider>
    </ToastProvider>
  );
}
