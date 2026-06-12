"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { AuthControls } from "@/components/auth/AuthControls";
import { ThemeSwitcher } from "./ThemeProvider";
import { SITE_NAME } from "@/lib/marketing";
import { getSubjectDefinition, type SubjectKey } from "@/lib/subject-definitions";

const PRIMARY: SubjectKey[] = ["gs1", "gs2", "gs3", "gs4", "essay"];

export function StudyNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const showBack = pathname !== "/";

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <header className="study-nav">
      <div className="study-nav-inner mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-6 lg:px-8">
        {showBack && (
          <button type="button" onClick={goBack} className="nav-back shrink-0" aria-label="Go back">
            <ArrowLeft size={17} aria-hidden="true" />
          </button>
        )}

        <Link
          href="/"
          className="nav-home shrink-0"
          aria-label={`${SITE_NAME} home`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push("/");
          }}
        >
          <span className="brand-mark">UP</span>
          <span className="text-sm font-semibold tracking-[-0.02em] sm:text-base" style={{ fontFamily: "var(--font-serif)" }}>
            {SITE_NAME}
          </span>
        </Link>

        <nav className="nav-scroll order-3 flex min-w-0 basis-full items-center gap-1 overflow-x-auto sm:order-none sm:flex-1 sm:basis-auto" aria-label="Papers">
          {PRIMARY.map((key) => {
            const subject = getSubjectDefinition(key);
            return (
              <Link
                key={key}
                href={subject.href}
                className="nav-pill"
                data-active={pathname === subject.href}
              >
                {subject.shortLabel}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2">
          <Link
            href="/browse"
            className="nav-pill"
            data-active={pathname.startsWith("/browse")}
            aria-label="Search all questions"
          >
            <Search size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Search</span>
          </Link>
          <ThemeSwitcher compact />
          <AuthControls compact />
        </div>
      </div>
    </header>
  );
}
