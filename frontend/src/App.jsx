import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BrandProvider } from "@/context/BrandContext";
import { ToastProvider } from "@/context/ToastContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import TodaySales from "@/pages/TodaySales";
import Cashier from "@/pages/Cashier";
import Products from "@/pages/Products";
import ProductCategories from "@/pages/ProductCategories";
import ProductAttributes from "@/pages/ProductAttributes";
import Barcode from "@/pages/Barcode";
import Suppliers from "@/pages/Suppliers";
import Customers from "@/pages/Customers";
import Users from "@/pages/Users";
import Invoices from "@/pages/Invoices";
import Logs from "@/pages/Logs";
import Settings from "@/pages/Settings";
import Expenses from "@/pages/Expenses";
import Funds from "@/pages/Funds";
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
            <Route path="/dashboard/today" element={<TodaySales />} />
            <Route path="/pos" element={<Cashier />} />
            <Route path="/products" element={<Navigate to="/products/list" replace />} />
            <Route path="/products/list" element={<Products />} />
            <Route path="/products/categories" element={<ProductCategories />} />
            <Route path="/products/attributes" element={<ProductAttributes />} />
            <Route path="/products/barcode" element={<Barcode />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/users" element={<Users />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/business/expenses" element={<Expenses />} />
            <Route path="/business/funds" element={<Funds />} />
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
