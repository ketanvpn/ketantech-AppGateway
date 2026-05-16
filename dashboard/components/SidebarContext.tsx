"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { usePathname } from "next/navigation";

/**
 * Context untuk koordinasi sidebar drawer (mobile/tablet) ↔ topbar hamburger button.
 * Di desktop (>= lg), sidebar selalu visible & state ini di-ignore.
 */
interface SidebarCtxValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

const SidebarCtx = createContext<SidebarCtxValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close drawer saat user navigate ke halaman lain (mobile pattern)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll saat drawer kebuka di mobile
  useEffect(() => {
    if (open) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <SidebarCtx.Provider value={{ open, setOpen, toggle }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebar(): SidebarCtxValue {
  const ctx = useContext(SidebarCtx);
  if (!ctx) {
    // Allow safe default kalau dipakai di luar provider (server render)
    return { open: false, setOpen: () => {}, toggle: () => {} };
  }
  return ctx;
}
