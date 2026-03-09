import { Button } from '@/components/ui/button'
import type { ImportBatchDetail, ImportRowRecord } from '@/types'

interface ImportReviewQueueProps {
  batch: ImportBatchDetail | null
  busyRowId: number | null
  onAccept: (rowId: number) => Promise<void>
  onReject: (rowId: number) => Promise<void>
}

function isPendingReview(row: ImportRowRecord): boolean {
  return row.status === 'needs_review' || row.status === 'duplicate'
}

export function ImportReviewQueue({
  batch,
  busyRowId,
  onAccept,
  onReject,
}: ImportReviewQueueProps) {
  const rows = batch?.rows.filter(isPendingReview) ?? []

  if (!batch || rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No rows awaiting review.</p>
  }

  return (
    <div className="grid gap-2">
      {rows.map((row) => {
        const busy = busyRowId === row.id

        return (
          <article
            key={row.id}
            className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {row.parsedDescription || row.rawText}
                </p>
                <p className="text-[0.65rem] text-muted-foreground">
                  {[row.parsedTxDate, row.status, row.merchantCandidate]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void onAccept(row.id)}
                >
                  {busy ? 'Working…' : 'Accept'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onReject(row.id)}
                >
                  Reject
                </Button>
              </div>
            </div>

            <div className="grid gap-1 text-xs text-muted-foreground">
              {row.parseNotes ? <p>{row.parseNotes}</p> : null}
              {row.referenceText ? <p>{row.referenceText}</p> : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
