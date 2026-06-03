"use client";

import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { AuthControls } from "@/components/auth/AuthControls";

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const router = useRouter();

  const C = {
    bg: "rgba(5,12,9,0.92)",
    border: "rgba(28,45,36,0.6)",
    text: "#E8EDEA",
    textSecondary: "#687D70",
    textMuted: "#3D5245",
    accent: "#4A7C59",
    elevated: "#0D1410",
  };

  return (
    <header
      className="h-[56px] shrink-0 flex items-center px-4 border-b backdrop-blur-sm"
      style={{ background: C.bg, borderColor: C.border }}
    >
      <button onClick={onMenuToggle} className="lg:hidden mr-3 p-1.5" style={{ color: C.textSecondary }}>
        <Menu size={20} />
      </button>

      <Link href="/" className="lg:hidden font-bold text-sm mr-3" style={{ color: C.text, textDecoration: "none" }}>
        UPS<span style={{ color: C.accent }}>Cat</span>
      </Link>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.target as HTMLFormElement).q as HTMLInputElement;
          if (input.value.trim()) router.push(`/browse?q=${encodeURIComponent(input.value.trim())}`);
        }}
        className="hidden sm:flex items-center flex-1 max-w-md"
      >
        <div className="relative w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
          <input
            name="q" type="text" placeholder="Search questions, topics, keywords..."
            className="input-terminal w-full pl-9 pr-3 py-2 text-sm"
            style={{ background: C.elevated }}
          />
        </div>
      </form>

      <div className="flex-1" />

      <div className="hidden md:block mr-2">
        <AuthControls compact />
      </div>

      <Link
        href="/browse"
        className="text-xs tracking-[0.08em] uppercase font-semibold px-3 py-1.5 transition-colors"
        style={{ color: C.textSecondary, textDecoration: "none" }}
      >
        Browse All
      </Link>
    </header>
  );
}
