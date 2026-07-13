"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { clearSession } from "@/lib/auth";
import { AiChat } from "./ai-chat";
import { usePermissions } from "./use-permissions";
import type { Permission } from "@stinventory/types";

type NavItem = { href: string; label: string; icon: string; perm?: Permission };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▤" },
  { href: "/assets", label: "Asset Register", icon: "▣", perm: "asset.read" },
  { href: "/assignments", label: "Assignments", icon: "◧", perm: "assignment.read" },
  { href: "/vehicles", label: "Vehicles", icon: "◲", perm: "vehicle.read" },
  { href: "/foremen", label: "Foremen", icon: "☰", perm: "employee.read" },
  { href: "/audit", label: "Audit Trail", icon: "≣", perm: "audit.read" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
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
    if (!getSession()) {
      router.replace("/");
      return;
    }
    if (me.data) setWho(`${me.data.firstName} ${me.data.lastName} · ${me.data.role ?? ""}`);
    if (me.error?.data?.code === "UNAUTHORIZED") {
      clearSession();
      router.replace("/");
    }
  }, [me.data, me.error, router]);

  const doLogout = async () => {
    const { logout } = await import("@/lib/auth");
    await logout();
    clearSession();
    router.replace("/");
  };

  const navTo = (href: string) => {
    router.push(href);
    setMenuOpen(false);
  };

  return (
    <div className="app">
      <aside className={`side ${menuOpen ? "open" : ""}`}>
        <div className="brand">ST<span>Inventory</span><small>Urban Infraconstruction</small></div>
        <nav className="nav">
          {visibleNav.map((n) => (
            <a
              key={n.href}
              className={pathname === n.href ? "active" : ""}
              onClick={() => navTo(n.href)}
            >
              <span style={{ width: 16, textAlign: "center", opacity: .9 }}>{n.icon}</span>
              {n.label}
            </a>
          ))}
          <a onClick={doLogout} style={{ marginTop: 20, cursor: "pointer" }}>
            <span style={{ width: 16, textAlign: "center" }}>⏻</span> Sign out
          </a>
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <button className="hamburger" onClick={() => setMenuOpen(!menuOpen)}>
            <span /> <span /> <span />
          </button>
          <h1>{NAV.find((n) => pathname?.startsWith(n.href))?.label ?? "STInventory"}</h1>
          <div className="topbar-right">
            {unread > 0 && <span className="notif-badge">{unread}</span>}
            <div className="who">{who}</div>
            <span className="d02-design-badge" style={{ color: "#6b7280", cursor: "pointer", border: "1px solid #e5e7eb", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "#f5f6f8", display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => router.push(pathname.replace(/^\//, "/d02/"))}>
              v1
            </span>
          </div>
        </div>
        <div className="wrap">{children}</div>
        <div className="foot">STInventory · event-sourced · derived state from transaction log</div>
      </main>
      <AiChat />
      {menuOpen && <div className="overlay" onClick={() => setMenuOpen(false)} />}
    </div>
  );
}

function getSession() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sti-session");
}
