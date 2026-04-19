import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import ChatFAB from "@/components/layout/ChatFAB";
import AuthGuard from "@/components/AuthGuard";
import { ToastContainer } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "RetailMind",
  description: "AI-powered analytics for retail SMEs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1">
          <AuthGuard>{children}</AuthGuard>
        </main>
        <ChatFAB />
        <ToastContainer />
      </body>
    </html>
  );
}
