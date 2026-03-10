import { BudgetProgressCard } from '@/components/BudgetProgressCard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { monthLabel } from '@/lib/format';
import type { BudgetPeriodRecord } from '@/types';
import { BudgetPeriodForm } from './BudgetPeriodForm';
import { BudgetTargetForm } from './BudgetTargetForm';
import { BudgetTargetList } from './BudgetTargetList';
import { useBudgetEditor } from '../hooks/useBudgetEditor';

interface BudgetSectionProps {
  activeMonth: string | null;
  period: BudgetPeriodRecord | null;
  onBudgetPeriodChanged: (period: BudgetPeriodRecord) => void;
}

export function BudgetSection({
  activeMonth,
  period,
  onBudgetPeriodChanged,
}: BudgetSectionProps) {
  const budgetEditor = useBudgetEditor({
    activeMonth,
    period,
    onBudgetPeriodChanged,
  });

  if (!activeMonth) {
    return <p className="text-xs text-muted-foreground">No active month is selected yet.</p>;
  }

  const targetedCategoryIds = new Set(period?.targets.map((target) => target.categoryId) ?? []);
  const availableCategories = budgetEditor.categories.filter(
    (category) => !targetedCategoryIds.has(category.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{monthLabel(activeMonth)}</Badge>
        {period ? <Badge variant="outline">{period.budgetName}</Badge> : null}
        {period ? <Badge variant="outline">{period.currency}</Badge> : null}
        {period ? <Badge variant="outline">{period.targets.length} target(s)</Badge> : null}
      </div>

      <BudgetStatusLine message={budgetEditor.status.message} tone={budgetEditor.status.tone} />

      <BudgetProgressCard period={period} />

      {!period ? (
        <BudgetPeriodForm
          activeMonth={activeMonth}
          pending={budgetEditor.creatingPeriod}
          onCreate={budgetEditor.actions.createPeriod}
        />
      ) : (
        <>
          <Separator />
          <BudgetTargetForm
            categories={availableCategories}
            pending={budgetEditor.savingTarget}
            onAddTarget={budgetEditor.actions.addTarget}
          />
          <BudgetTargetList
            period={period}
            pending={budgetEditor.savingTarget}
            deletingTargetId={budgetEditor.deletingTargetId}
            onUpdateTarget={budgetEditor.actions.updateTarget}
            onDeleteTarget={budgetEditor.actions.removeTarget}
          />
        </>
      )}

      {budgetEditor.categoriesLoading ? (
        <p className="text-xs text-muted-foreground">Loading budget categories…</p>
      ) : null}
    </div>
  );
}

function BudgetStatusLine({
  message,
  tone,
}: {
  message: string;
  tone: 'idle' | 'pending' | 'success' | 'error';
}) {
  if (!message || tone === 'idle') {
    return null;
  }

  if (tone === 'error') {
    return (
      <Alert variant="destructive" className="py-2">
        <AlertDescription className="text-xs">{message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <p
      className={
        tone === 'success' ? 'text-xs text-[var(--color-success)]' : 'text-xs text-muted-foreground'
      }
    >
      {message}
    </p>
  );
}
