export default function BrowseLoading() {
  const C = { bg: "#050C09", surface: "#090F0C", border: "#1C2D24", elevated: "#0D1410" };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8" style={{ background: C.bg }}>
      <div className="animate-pulse space-y-4">
        <div className="h-12 terminal-frame" style={{ background: C.elevated }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="terminal-frame p-5">
            <div className="flex gap-4">
              <div className="flex-1 space-y-3">
                <div className="h-4 w-3/4" style={{ background: "rgba(104,125,112,0.1)" }} />
                <div className="h-3 w-1/4" style={{ background: "rgba(104,125,112,0.06)" }} />
              </div>
              <div className="w-12 h-12 shrink-0" style={{ background: "rgba(104,125,112,0.08)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
