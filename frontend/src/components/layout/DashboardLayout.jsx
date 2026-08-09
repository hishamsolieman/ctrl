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
      {/* Same backdrop as login: dotted grid + soft top glow. The glow is what
          makes the dots actually readable on pure black. */}
      <div className="ctrl-grid-bg relative flex min-w-0 flex-1 flex-col">
        <div
          className="ctrl-grid-glow pointer-events-none absolute inset-x-0 top-0 z-0 h-64"
          aria-hidden
        />
        <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar
            onOpenMobile={() => setMobileOpen(true)}
            collapsed={collapsed}
          />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6">
            <div className="flex min-h-0 flex-1 animate-fade-in flex-col">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
