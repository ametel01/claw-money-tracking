import type { PieSegment } from '@/types';

interface CategoryPieProps {
  segments: PieSegment[];
}

export function CategoryPie({ segments }: CategoryPieProps) {
  const gradientParts: string[] = [];
  let start = 0;

  for (const segment of segments) {
    const end = start + segment.pct;
    gradientParts.push(`${segment.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
    start = end;
  }

  const pieStyle =
    segments.length > 0
      ? { background: `conic-gradient(${gradientParts.join(',')})` }
      : { background: 'conic-gradient(var(--color-secondary) 0 360deg)' };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div
        className="size-32 shrink-0 self-start rounded-full border border-border shadow-[0_0_0_8px_var(--color-card),inset_0_0_0_12px_var(--color-card)]"
        style={pieStyle}
        role="img"
        aria-label="Expense category split chart"
      />

      <div className="grid gap-1.5 min-w-0">
        {segments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No expense data yet.</p>
        ) : (
          segments.map((segment) => (
            <div
              key={segment.name}
              className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="size-1.5 shrink-0 rounded-[1px]"
                  style={{ background: segment.color }}
                />
                <span className="truncate text-foreground">{segment.name}</span>
              </span>
              <span className="tabular-nums whitespace-nowrap text-muted-foreground">
                {segment.pct.toFixed(1)}%
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
