import { Badge } from '@/components/ui/badge';
import { monthLabel } from '@/lib/format';
import type { ImportBatchDetail } from '@/types';

interface ImportBatchStatusProps {
  batch: ImportBatchDetail | null;
}

export function ImportBatchStatus({ batch }: ImportBatchStatusProps) {
  if (!batch) {
    return <p className="text-xs text-muted-foreground">No import batches yet.</p>;
  }

  const createdDate = batch.createdAt.slice(0, 7);

  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground break-all sm:truncate">
            {batch.sourceFilename || 'Imported PDF'}
          </p>
          <p className="text-[0.65rem] text-muted-foreground break-words">
            {batch.accountName || 'Unknown account'}
            {createdDate ? ` • ${monthLabel(createdDate)}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          {batch.status}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">Accepted {batch.counts.accepted}</Badge>
        <Badge variant="outline">Review {batch.counts.needs_review}</Badge>
        <Badge variant="outline">Duplicate {batch.counts.duplicate}</Badge>
        <Badge variant="outline">Rejected {batch.counts.rejected}</Badge>
      </div>
    </div>
  );
}
