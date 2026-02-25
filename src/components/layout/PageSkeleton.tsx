export function PageSkeleton() {
  return (
    <div className="space-y-6 p-6 animate-pulse">
      {/* Header */}
      <div className="h-8 w-48 rounded bg-muted" />

      {/* Stat cards row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-muted" />
        ))}
      </div>

      {/* Main content */}
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-4 w-4/6 rounded bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-3/4 rounded bg-muted" />
      </div>

      {/* Second block */}
      <div className="h-48 rounded-lg bg-muted" />
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
      <div className="mt-4 h-8 w-full rounded bg-muted" />
    </div>
  );
}

