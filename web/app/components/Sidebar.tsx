"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Twitter, BarChart3, PieChart, Wallet, Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/tweets", icon: Twitter, label: "Tweets" },
  { href: "/trade", icon: BarChart3, label: "Trade" },
  { href: "/portfolio", icon: PieChart, label: "Portfolio" },
  { href: "/wallets", icon: Wallet, label: "Wallets" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-16 bg-[#060606] border-r border-[#1a1a1a] shrink-0">
      {/* Logo */}
      <div className="flex items-center justify-center h-12 border-b border-[#1a1a1a]">
        <div className="w-7 h-7 rounded-lg overflow-hidden">
          <img src="/elon-red.jpg" alt="" className="w-full h-full object-cover" />
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 flex flex-col items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 w-12 py-1.5 rounded-lg text-center transition-colors ${
                isActive
                  ? "bg-[#131313] text-[#3b82f6]"
                  : "text-[#555555] hover:text-[#e5e5e5] hover:bg-[#131313]"
              }`}
            >
              <Icon size={18} />
              <span className="text-[9px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
