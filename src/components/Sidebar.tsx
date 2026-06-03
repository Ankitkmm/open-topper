"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronRight, X, Flame, Layers, Home } from "lucide-react";
import Link from "next/link";
import { AuthControls } from "@/components/auth/AuthControls";
import type { CategoriesMeta } from "@/lib/types";

interface SidebarProps {
  categoriesMeta: CategoriesMeta;
  keywords: { keyword: string; count: number }[];
}

const CAT_ICONS: Record<string, string> = {
  "GS 1": "📜", "GS 2": "🏛️", "GS 3": "📊", "GS 4": "⚖️",
  Essay: "✍️", Geography: "🌍", Sociology: "👥",
  PSIR: "🌐", "Public Administration": "🏢", Anthropology: "🧬", History: "🏰",
};

export function Sidebar({ categoriesMeta, keywords }: SidebarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const currentCategory = params.get("category") || "all";
  const currentKeyword = params.get("keyword") || "";

  const [showKeywords, setShowKeywords] = useState(true);
  const [showOptionals, setShowOptionals] = useState(true);
  const [kwFilter, setKwFilter] = useState("");

  const gsCategories = categoriesMeta.categories.filter((c) =>
    ["GS 1", "GS 2", "GS 3", "GS 4", "Essay"].includes(c.name),
  );
  const optionalCategories = categoriesMeta.categories.filter((c) =>
    ["Geography", "Sociology", "PSIR", "Public Administration", "Anthropology", "History"].includes(c.name),
  );

  const filteredKw = useMemo(() => {
    if (!kwFilter.trim()) return keywords.slice(0, 60);
    const q = kwFilter.toLowerCase();
    return keywords.filter((k) => k.keyword.toLowerCase().includes(q)).slice(0, 60);
  }, [keywords, kwFilter]);

  const getSubjectUrl = (catName: string): string => {
    const map: Record<string, string> = {
      "GS 1": "/gs1", "GS 2": "/gs2", "GS 3": "/gs3", "GS 4": "/gs4",
      Essay: "/essay", Geography: "/optional/geography",
      Sociology: "/optional/sociology", PSIR: "/optional/psir",
      "Public Administration": "/optional/public-administration",
      Anthropology: "/optional/anthropology", History: "/gs1",
    };
    return map[catName] || `/browse?category=${encodeURIComponent(catName.toLowerCase())}`;
  };

  const C = {
    bg: "#050C09",
    surface: "#090F0C",
    elevated: "#0D1410",
    border: "rgba(28,45,36,0.6)",
    text: "#E8EDEA",
    textSecondary: "#687D70",
    textMuted: "#3D5245",
    accent: "#4A7C59",
    accentDim: "rgba(74,124,89,0.1)",
  };

  return (
    <aside className="w-64 shrink-0 flex flex-col h-screen border-r" style={{ background: C.bg, borderColor: C.border }}>
      {/* Brand */}
      <div className="px-4 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <h1 className="text-lg font-bold tracking-tight" style={{ color: C.text }}>
            UPS<span style={{ color: C.accent }}>Cat</span>
          </h1>
        </Link>
        <p className="text-xs mt-1 font-mono" style={{ color: C.textMuted }}>
          {categoriesMeta.total_questions.toLocaleString()} q · {categoriesMeta.total_toppers.toLocaleString()} signals
        </p>
        <div className="mt-3">
          <AuthControls compact />
        </div>
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.target as HTMLFormElement).q as HTMLInputElement;
          const sp = new URLSearchParams();
          if (input.value.trim()) sp.set("q", input.value.trim());
          if (currentCategory && currentCategory !== "all") sp.set("category", currentCategory);
          router.push(sp.toString() ? `/browse?${sp.toString()}` : "/browse");
        }}
        className="px-3 py-3" style={{ borderBottom: `1px solid ${C.border}` }}
      >
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2" style={{ color: C.textMuted }} />
          <input
            name="q"
            type="text"
            placeholder="Search..."
            defaultValue={params.get("q") || ""}
            className="input-terminal w-full pl-8 pr-3 py-2 text-sm"
            style={{ background: C.elevated }}
          />
        </div>
      </form>

      <div className="flex-1 overflow-y-auto">
        {/* Categories */}
        <div className="px-3 py-3">
          <p className="overline mb-2 px-1">General Studies</p>
          <Link
            href="/browse"
            className="flex items-center gap-2 px-2.5 py-2 mb-0.5 text-sm transition-colors"
            style={{
              color: currentCategory === "all" && !currentKeyword ? C.accent : C.textSecondary,
              background: currentCategory === "all" && !currentKeyword ? C.accentDim : "transparent",
            }}
          >
            <Home size={13} /> All Questions
          </Link>
          {gsCategories.map((cat) => {
            const active = currentCategory === cat.name && !currentKeyword;
            return (
              <Link
                key={cat.name}
                href={getSubjectUrl(cat.name)}
                className="flex items-center justify-between px-2.5 py-2 text-sm transition-colors"
                style={{
                  color: active ? C.accent : C.textSecondary,
                  background: active ? C.accentDim : "transparent",
                }}
              >
                <span><span className="mr-2">{CAT_ICONS[cat.name] || "📄"}</span>{cat.name}</span>
                <span className="font-mono text-xs" style={{ color: active ? "rgba(74,124,89,0.6)" : C.textMuted }}>
                  {cat.count.toLocaleString()}
                </span>
              </Link>
            );
          })}

          <button
            onClick={() => setShowOptionals(!showOptionals)}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-sm transition-colors mt-1"
            style={{ color: C.textSecondary }}
          >
            <Layers size={13} /> Optional Subjects
            <ChevronDown size={13} className="ml-auto transition-transform" style={{ transform: showOptionals ? "rotate(180deg)" : "none" }} />
          </button>
          {showOptionals && optionalCategories.map((cat) => {
            const active = currentCategory === cat.name && !currentKeyword;
            return (
              <Link
                key={cat.name}
                href={getSubjectUrl(cat.name)}
                className="flex items-center justify-between pl-8 pr-2.5 py-2 text-sm transition-colors"
                style={{
                  color: active ? C.accent : C.textMuted,
                  background: active ? C.accentDim : "transparent",
                }}
              >
                <span><span className="mr-2">{CAT_ICONS[cat.name] || "📄"}</span>{cat.name}</span>
                <span className="font-mono text-xs" style={{ color: C.textMuted }}>{cat.count.toLocaleString()}</span>
              </Link>
            );
          })}
        </div>

        <div className="mx-3" style={{ borderTop: `1px solid ${C.border}` }} />

        {/* Keywords */}
        <div className="px-3 py-3">
          <button
            onClick={() => setShowKeywords(!showKeywords)}
            className="flex items-center justify-between w-full overline mb-2 px-1"
          >
            <span>Keywords</span>
            {showKeywords ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {showKeywords && (
            <>
              <input
                type="text" placeholder="Filter..." value={kwFilter}
                onChange={(e) => setKwFilter(e.target.value)}
                className="input-terminal w-full px-2.5 py-1.5 mb-2 text-xs"
                style={{ background: C.elevated }}
              />
              {currentKeyword && (
                <button onClick={() => router.push("/browse")} className="text-xs mb-1.5 flex items-center gap-1" style={{ color: C.accent }}>
                  <X size={10} /> Clear
                </button>
              )}
              <div className="space-y-0.5 max-h-[35vh] overflow-y-auto">
                {filteredKw.map(({ keyword, count }) => {
                  const active = currentKeyword === keyword;
                  return (
                    <button
                      key={keyword}
                      onClick={() => {
                        const nk = active ? "" : keyword;
                        router.push(nk ? `/browse?keyword=${encodeURIComponent(nk)}` : "/browse");
                      }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs transition-colors"
                      style={{
                        color: active ? C.accent : C.textMuted,
                        background: active ? C.accentDim : "transparent",
                      }}
                    >
                      <span className="truncate">{keyword}</span>
                      <span className="font-mono text-[11px] ml-2 shrink-0">{count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Topic Density */}
        <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-1.5 mb-2 px-1">
            <Flame size={12} style={{ color: "#4A7C59" }} />
            <span className="overline">Topic Density</span>
          </div>
          <div className="flex flex-wrap gap-[3px]">
            {keywords.slice(0, 35).map(({ keyword, count }) => {
              const max = keywords[0]?.count || 1;
              const intensity = count / max;
              let bg = "rgba(74,124,89,0.06)";
              if (intensity > 0.8) bg = "rgba(74,124,89,0.8)";
              else if (intensity > 0.6) bg = "rgba(74,124,89,0.5)";
              else if (intensity > 0.4) bg = "rgba(74,124,89,0.3)";
              else if (intensity > 0.2) bg = "rgba(74,124,89,0.15)";
              return (
                <div key={keyword} title={`${keyword}: ${count.toLocaleString()} questions`}
                  className="w-[8px] h-[8px] transition-colors" style={{ background: bg }} />
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
