import { ImportBatchStatus } from '@/components/ImportBatchStatus';
import { ImportForm } from '@/components/ImportForm';
import { DashboardSection } from '@/features/dashboard/components/DashboardSection';
import type { ImportBatchDetail } from '@/types';

interface ImportWorkflowSectionProps {
  latestImportBatch: ImportBatchDetail | null;
  latestBatchSummary: string | undefined;
  onImported: () => Promise<void>;
}

export function ImportWorkflowSection({
  latestImportBatch,
  latestBatchSummary,
  onImported,
}: ImportWorkflowSectionProps) {
  return (
    <DashboardSection
      spanClassName="col-span-12 md:col-span-6"
      cardClassName="h-full border-t-2 border-t-[oklch(0.60_0.20_245)]"
      eyebrow="Import"
      title="PDF statements"
      description="Upload a bank PDF to parse and import transactions."
    >
      <div className="grid gap-3">
        <ImportForm onImported={onImported} {...(latestBatchSummary ? { latestBatchSummary } : {})} />
        <ImportBatchStatus batch={latestImportBatch} />
      </div>
    </DashboardSection>
  );
}
