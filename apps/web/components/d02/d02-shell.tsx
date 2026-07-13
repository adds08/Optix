"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { clearSession } from "@/lib/auth";
import { usePermissions } from "@/components/use-permissions";
import type { Permission } from "@stinventory/types";
import {
  LayoutDashboard, Package, ArrowLeftRight, Truck, Users, ScrollText, LogOut, Bell
} from "lucide-react";
import { AiChat } from "@/components/ai-chat";
import { ToastProvider } from "./d02-toast";

type NavItem = { href: string; label: string; icon: React.ReactNode; perm?: Permission };

const NAV: NavItem[] = [
  { href: "/d02/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/d02/assets", label: "Asset Register", icon: <Package size={18} />, perm: "asset.read" },
  { href: "/d02/assignments", label: "Assignments", icon: <ArrowLeftRight size={18} />, perm: "assignment.read" },
  { href: "/d02/vehicles", label: "Vehicles", icon: <Truck size={18} />, perm: "vehicle.read" },
  { href: "/d02/foremen", label: "Foremen", icon: <Users size={18} />, perm: "employee.read" },
  { href: "/d02/audit", label: "Audit Trail", icon: <ScrollText size={18} />, perm: "audit.read" },
];

function getSession() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sti-session");
}

export function D02Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [who, setWho] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const me = trpc.identity.me.useQuery();
  const notifications = trpc.notification.list.useQuery(undefined, { refetchInterval: 30_000 });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;
  const { has } = usePermissions();

  const visibleNav = NAV.filter((n) => !n.perm || has(n.perm));

  useEffect(() => {
    if (!getSession()) { router.replace("/"); return; }
    if (me.data) setWho(`${me.data.firstName} ${me.data.lastName} · ${me.data.role ?? ""}`);
    if (me.error?.data?.code === "UNAUTHORIZED") { clearSession(); router.replace("/"); }
  }, [me.data, me.error, router]);

  const doLogout = async () => {
    const { logout } = await import("@/lib/auth");
    await logout(); clearSession(); router.replace("/");
  };

  const navTo = (href: string) => { router.push(href); setMenuOpen(false); };

  return (
    <div className="d02">
      <div className="d02-app">
        <aside className={`d02-side ${menuOpen ? "d02-open" : ""}`}>
          <div className="d02-brand">
            <Package size={20} style={{ color: "var(--d2-accent)" }} />
            <span>ST<span>Inventory</span></span>
          </div>
          <nav className="d02-nav">
            {visibleNav.map((n) => (
              <a key={n.href} className={pathname === n.href ? "active" : ""} onClick={() => navTo(n.href)}>
                {n.icon}{n.label}
              </a>
            ))}
            <a onClick={doLogout} style={{ marginTop: 24, cursor: "pointer" }}>
              <LogOut size={18} /> Sign out
            </a>
          </nav>
        </aside>
        <main className="d02-main">
          <div className="d02-topbar">
            <button className="d02-hamburger" onClick={() => setMenuOpen(!menuOpen)}>
              <span /><span /><span />
            </button>
            <h1>{NAV.find((n) => pathname?.startsWith(n.href))?.label ?? "STInventory"}</h1>
            <div className="d02-topbar-right">
              {unread > 0 && <span className="d02-notif-badge">{unread}</span>}
              <div className="d02-who">{who}</div>
              <span className="d02-design-badge" onClick={() => {
                const cur = pathname.replace("/d02/", "/");
                router.push(cur);
              }}>
                v2
              </span>
            </div>
          </div>
          <div className="d02-wrap">
            <ToastProvider>
              {children}
            </ToastProvider>
          </div>
          <div className="d02-foot">STInventory · v2 Design · event-sourced</div>
        </main>
        <AiChat />
        {menuOpen && <div className="d02-overlay" onClick={() => setMenuOpen(false)} />}
      </div>
    </div>
  );
}
