"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, FolderOpen, LogOut, Plus, Menu, X, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut, getUserEmail, isAuthenticated } from "@/lib/auth";
import ThemeToggle from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Projects", icon: FolderOpen },
  { href: "/models", label: "Models", icon: Brain },
];

/** Routes where the navbar should be hidden */
const HIDDEN_ROUTES = ["/", "/auth/login", "/auth/signup"];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setUserEmail(getUserEmail());
    } else {
      setUserEmail(null);
    }
  }, [pathname]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Hide navbar on landing page and auth pages
  if (HIDDEN_ROUTES.includes(pathname)) return null;

  const handleLogout = () => {
    signOut();
    router.push("/auth/login");
  };

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border/40">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground font-display text-lg"
        >
          <BarChart3 className="h-5 w-5 text-emerald-600" />
          RetailMind
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-300",
                pathname?.startsWith(item.href)
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {userEmail && (
            <span className="hidden text-xs text-muted-foreground lg:inline-block max-w-[180px] truncate">
              {userEmail}
            </span>
          )}

          {/* Desktop buttons */}
          <div className="hidden lg:flex items-center gap-3">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:bg-foreground/90 transition-all duration-300"
            >
              <Plus className="h-4 w-4" />
              New Project
            </Link>
            <ThemeToggle />
            <button
              className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg p-1.5 transition-all duration-300"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile: theme toggle always visible + hamburger */}
          <div className="flex lg:hidden items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg p-1.5 transition-all duration-300"
              title="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-border/40 bg-background/95 backdrop-blur-xl">
          <div className="mx-auto max-w-5xl px-6 py-4 space-y-2">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-300",
                  pathname?.startsWith(item.href)
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
            <Link
              href="/projects/new"
              className="flex items-center gap-2 rounded-lg bg-foreground px-3 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-all duration-300"
            >
              <Plus className="h-4 w-4" />
              New Project
            </Link>
            {userEmail && (
              <p className="px-3 py-1 text-xs text-muted-foreground truncate">
                {userEmail}
              </p>
            )}
            <button
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-300 w-full"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
