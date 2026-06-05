"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Check, Gem, Moon, Palette, Sprout, Sun, Waves } from "lucide-react";

const THEMES = [
  { id: "library", label: "Library", icon: Sun },
  { id: "sage", label: "Sage", icon: Sprout },
  { id: "sepia", label: "Sepia", icon: Waves },
  { id: "amethyst", label: "Purple", icon: Gem },
  { id: "night", label: "Night", icon: Moon },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const STORAGE_KEY = "openupsc:theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme(next) {
      setThemeState(next);
      document.documentElement.dataset.theme = next;
      window.localStorage.setItem(STORAGE_KEY, next);
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "library";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return THEMES.some((item) => item.id === stored) ? (stored as ThemeId) : "library";
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const context = useContext(ThemeContext);
  if (!context) return null;

  return (
    <div className="theme-switcher" aria-label="Theme selector">
      {!compact && (
        <span className="theme-switcher-label">
          <Palette size={14} aria-hidden="true" />
          Theme
        </span>
      )}
      <div className="theme-options">
        {THEMES.map((item) => {
          const Icon = item.icon;
          const active = context.theme === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="theme-option"
              data-active={active}
              onClick={() => context.setTheme(item.id)}
              title={`${item.label} theme`}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{item.label}</span>
              {active && <Check size={13} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
