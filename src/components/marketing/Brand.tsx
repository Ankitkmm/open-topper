import Image from "next/image";
import Link from "next/link";
import { SITE_NAME } from "@/lib/marketing";

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-3 ${compact ? "" : "group"}`}>
      <span className={`relative grid overflow-hidden rounded-[1.4rem] border border-terminal bg-[var(--bg-surface)] ${compact ? "h-10 w-10" : "h-12 w-12"}`}>
        <span
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--gold) 24%, transparent), transparent 55%), linear-gradient(160deg, color-mix(in srgb, var(--bg-surface) 88%, white), color-mix(in srgb, var(--accent-soft) 80%, transparent))",
          }}
        />
        <span className="relative grid place-items-center text-[var(--fg-primary)]">
          <Image
            src="/brand/cat-silhouette.svg"
            alt=""
            width={compact ? 24 : 30}
            height={compact ? 24 : 30}
            className="translate-x-[1px] translate-y-[1px]"
            style={{ height: "auto" }}
          />
        </span>
      </span>
      <span>
        <span className="block text-lg font-semibold leading-none tracking-[-0.03em]">{SITE_NAME}</span>
        <span className="mt-1 block text-xs text-muted">Track prep. Search PYQs. Revise smarter.</span>
      </span>
    </Link>
  );
}
