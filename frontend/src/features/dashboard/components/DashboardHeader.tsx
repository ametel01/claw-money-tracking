import {
  type DashboardLoadStatus,
  getLoadStatusClassName,
} from '@/features/dashboard/lib/dashboardStatus';

interface DashboardHeaderProps {
  status: DashboardLoadStatus;
}

export function DashboardHeader({ status }: DashboardHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-primary">
          Money Tracking
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Expenses Dashboard</h1>
        <p className="max-w-[56ch] text-sm text-muted-foreground">
          SQLite-backed statement imports, FX normalization, and lean visual summaries.
        </p>
      </div>
      <p className={getLoadStatusClassName(status.tone)} aria-live="polite">
        {status.message}
      </p>
    </header>
  );
}
