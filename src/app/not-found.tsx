import Link from "next/link";
import { FileQuestion, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const C = { bg: "#050C09", text: "#E8EDEA", textSecondary: "#687D70", accent: "#4A7C59" };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: C.bg }}>
      <div className="text-center max-w-md">
        <FileQuestion size={64} className="mx-auto mb-6" style={{ color: "rgba(104,125,112,0.15)" }} />
        <h1 className="text-3xl font-bold mb-3" style={{ color: C.text }}>Page not found</h1>
        <p className="text-sm mb-8 leading-relaxed" style={{ color: C.textSecondary }}>
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/" className="btn-secondary"><ArrowLeft size={15} /> Home</Link>
          <Link href="/browse" className="btn-primary">Browse Questions</Link>
        </div>
      </div>
    </div>
  );
}
