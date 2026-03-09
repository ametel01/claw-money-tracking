import { ImportReviewQueue } from '@/components/ImportReviewQueue';
import { DashboardSection } from '@/features/dashboard/components/DashboardSection';
import type { ImportBatchDetail } from '@/types';

interface ImportReviewSectionProps {
  latestImportBatch: ImportBatchDetail | null;
  busyReviewRowId: number | null;
  onAccept: (rowId: number) => Promise<void>;
  onReject: (rowId: number) => Promise<void>;
}

export function ImportReviewSection({
  latestImportBatch,
  busyReviewRowId,
  onAccept,
  onReject,
}: ImportReviewSectionProps) {
  return (
    <DashboardSection
      spanClassName="col-span-12"
      eyebrow="Review"
      title="Import review queue"
      description="Accept or reject `needs_review` and `duplicate` rows from the latest import batch."
    >
      <ImportReviewQueue
        batch={latestImportBatch}
        busyRowId={busyReviewRowId}
        onAccept={onAccept}
        onReject={onReject}
      />
    </DashboardSection>
  );
}
