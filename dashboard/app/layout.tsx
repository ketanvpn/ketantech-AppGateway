import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { AuthGuard, LogoutButton } from "@/components/AuthGuard";
import { Topbar } from "@/components/Topbar";
import { SidebarProvider } from "@/components/SidebarContext";
import { ToastProvider } from "@/components/Toast";


export const metadata: Metadata = {
  title: "KetantechPay · Admin Dashboard",
  description:
    "KetantechPay — Multi-provider payment gateway by Ketantech. Auto-fallback, idempotency, dashboard real-time.",
};


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <ToastProvider>
          <AuthGuard>
            <SidebarProvider>
              {/* Layout uses sticky sidebar on lg+, drawer on smaller screens */}
              <div className="flex min-h-screen bg-slate-50">
                <Sidebar />
                <main className="flex min-w-0 flex-1 flex-col">
                  <Topbar action={<LogoutButton />} />
                  <div className="mx-auto w-full max-w-7xl flex-1 animate-fade-in px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                    {children}
                  </div>
                </main>
              </div>
            </SidebarProvider>
          </AuthGuard>
        </ToastProvider>

      </body>
    </html>
  );
}
