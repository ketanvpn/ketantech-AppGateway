"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebar } from "./SidebarContext";

/**
 * Navigation tree — dikelompokkan supaya lebih mudah dibaca saat menu bertambah.
 */
const groups: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: React.ReactNode }>;
}> = [
  {
    title: "Operasional",
    items: [
      { href: "/", label: "Dashboard", icon: <IconDashboard /> },
      { href: "/transactions", label: "Transactions", icon: <IconReceipt /> },
      { href: "/test-charge", label: "Test Charge", icon: <IconBolt /> },
    ],
  },
  {
    title: "Konfigurasi",
    items: [
      { href: "/credentials", label: "Credentials", icon: <IconKey /> },
      { href: "/orderkuota", label: "OrderKuota", icon: <IconMobile /> },
      { href: "/settings", label: "Providers", icon: <IconSliders /> },
      { href: "/system", label: "System", icon: <IconWrench /> },
    ],
  },
  {
    title: "Resources",
    items: [{ href: "/docs", label: "Docs", icon: <IconBook /> }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { open, setOpen } = useSidebar();

  return (
    <>
      {/* ── Mobile overlay backdrop (hidden on lg+) ─────────────── */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar — drawer di mobile/tablet, sticky di desktop ─ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-900/40 bg-slate-950 text-slate-200 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand row */}
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-white">
                Payment Gateway
              </div>
              <div className="text-[11px] text-slate-400">
                Application Gateway
              </div>
            </div>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={() => setOpen(false)}
            className="-mr-2 rounded-md p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Tutup menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g.title} className="mb-4">
              <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {g.title}
              </div>
              <div className="space-y-0.5">
                {g.items.map((l) => {
                  const active =
                    l.href === "/"
                      ? pathname === "/"
                      : pathname?.startsWith(l.href) ?? false;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all ${
                        active
                          ? "bg-brand-600/20 text-white shadow-sm ring-1 ring-inset ring-brand-500/30"
                          : "text-slate-300 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center transition-colors ${
                          active
                            ? "text-brand-300"
                            : "text-slate-400 group-hover:text-slate-200"
                        }`}
                      >
                        {l.icon}
                      </span>
                      <span>{l.label}</span>
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-400" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer status */}
        <div className="border-t border-white/5 px-4 py-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span>System Operational</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            v1.0 · Application Gateway Pattern
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Inline icons (24x24, stroke-based) ─────────────────────────

function Logo() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-700/30">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5 text-white"
      >
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    </div>
  );
}

const iconProps = {
  className: "h-4 w-4",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconDashboard() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg {...iconProps}>
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg {...iconProps}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg {...iconProps}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M21 2 11 12M16 7l3 3M14 9l3 3" />
    </svg>
  );
}
function IconMobile() {
  return (
    <svg {...iconProps}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  );
}
function IconSliders() {
  return (
    <svg {...iconProps}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="7" cy="18" r="2" fill="currentColor" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg {...iconProps}>
      <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.9 2.9-2-2 2.9-2.9z" />
    </svg>
  );
}
function IconBook() {
  return (
    <svg {...iconProps}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
