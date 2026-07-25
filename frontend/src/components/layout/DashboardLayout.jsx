import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false); // desktop: icons-only
  const [mobileOpen, setMobileOpen] = useState(false); // mobile: drawer

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6">
          <div className="flex min-h-0 flex-1 animate-fade-in flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
