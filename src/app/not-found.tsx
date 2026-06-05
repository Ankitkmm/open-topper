import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="library-page flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <FileQuestion size={56} className="mx-auto mb-6 text-muted" aria-hidden="true" />
        <h1 className="text-3xl tracking-[-0.02em]">Page not found</h1>
        <p className="mt-3 text-sm leading-7 text-secondary">
          The page you are looking for does not exist or has moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/" className="btn-secondary">
            <ArrowLeft size={15} aria-hidden="true" /> Home
          </Link>
          <Link href="/browse" className="btn-primary">
            Search questions
          </Link>
        </div>
      </div>
    </main>
  );
}
