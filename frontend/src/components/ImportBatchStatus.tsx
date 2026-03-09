import { Badge } from '@/components/ui/badge'
import { monthLabel } from '@/lib/format'
import type { ImportBatchDetail } from '@/types'

interface ImportBatchStatusProps {
  batch: ImportBatchDetail | null
}

export function ImportBatchStatus({ batch }: ImportBatchStatusProps) {
  if (!batch) {
    return <p className="text-xs text-muted-foreground">No import batches yet.</p>
  }

  const createdDate = batch.createdAt.slice(0, 7)

  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">
            {batch.sourceFilename || 'Imported PDF'}
          </p>
          <p className="text-[0.65rem] text-muted-foreground">
            {batch.accountName || 'Unknown account'}
            {createdDate ? ` • ${monthLabel(createdDate)}` : ''}
          </p>
        </div>
        <Badge variant="outline">{batch.status}</Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">Accepted {batch.counts.accepted}</Badge>
        <Badge variant="outline">Review {batch.counts.needs_review}</Badge>
        <Badge variant="outline">Duplicate {batch.counts.duplicate}</Badge>
        <Badge variant="outline">Rejected {batch.counts.rejected}</Badge>
      </div>
    </div>
  )
}
