import { BudgetProgressCard } from '@/components/BudgetProgressCard';
import { CashFlowCard } from '@/components/CashFlowCard';
import { CategoryPie } from '@/components/CategoryPie';
import { CurrencyControls } from '@/components/CurrencyControls';
import { KpiCards } from '@/components/KpiCards';
import { LineChart } from '@/components/LineChart';
import { MerchantLeaderboardCard } from '@/components/MerchantLeaderboardCard';
import { MonthTabs } from '@/components/MonthTabs';
import { RecurringPreviewCard } from '@/components/RecurringPreviewCard';
import { TransactionList } from '@/components/TransactionList';
import { ImportReviewSection } from '@/features/imports/components/ImportReviewSection';
import { ImportWorkflowSection } from '@/features/imports/components/ImportWorkflowSection';
import { monthLabel } from '@/lib/format';
import type { UseExpensesDashboardResult } from '../hooks/useExpensesDashboard';
import { DashboardHeader } from './DashboardHeader';
import { DashboardSection } from './DashboardSection';

export function ExpensesDashboardPage({
  state,
  loading,
  activeBudgetPeriod,
  latestBatchSummary,
  actions,
}: UseExpensesDashboardResult) {
  const {
    overview,
    transactions,
    months,
    pieSegments,
    lineChartModel,
    cashFlow,
    merchantLeaderboard,
    latestImportBatch,
    busyReviewRowId,
    recurringInsights,
    activeMonth,
    viewMode,
    loadStatus,
  } = state;

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-6 pb-16">
      <DashboardHeader status={loadStatus} />

      <main className="grid grid-cols-12 gap-4">
        <DashboardSection
          spanClassName="col-span-12"
          cardClassName="border-t-2 border-t-primary"
          eyebrow="Overview"
          title="Live snapshot"
        >
          <KpiCards overview={overview} loading={loading} />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12 md:col-span-6"
          cardClassName="h-full"
          eyebrow="Allocation"
          title="Category split"
        >
          <CategoryPie segments={pieSegments} />
        </DashboardSection>

        <ImportWorkflowSection
          latestImportBatch={latestImportBatch}
          latestBatchSummary={latestBatchSummary}
          onImported={actions.refreshDashboard}
        />

        <DashboardSection
          spanClassName="col-span-12"
          eyebrow="Spending Pace"
          title="Cumulative spend by day"
          description="Track how quickly expenses stack up in the selected month versus the prior month."
          contentClassName="flex flex-col gap-4"
        >
          <MonthTabs
            months={months}
            activeMonth={activeMonth}
            onMonthChange={(month) => void actions.handleMonthChange(month)}
          />
          <LineChart model={lineChartModel} />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12 md:col-span-4"
          cardClassName="h-full"
          eyebrow="Cash Flow"
          title="Monthly cash flow"
        >
          <CashFlowCard points={cashFlow} activeMonth={activeMonth} />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12 md:col-span-4"
          cardClassName="h-full"
          eyebrow="Merchants"
          title="Merchant leaderboard"
        >
          <MerchantLeaderboardCard merchants={merchantLeaderboard} activeMonth={activeMonth} />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12 md:col-span-4"
          cardClassName="h-full"
          eyebrow="Recurring"
          title="Recurring charges preview"
        >
          <RecurringPreviewCard insights={recurringInsights} />
        </DashboardSection>

        <ImportReviewSection
          latestImportBatch={latestImportBatch}
          busyReviewRowId={busyReviewRowId}
          onAccept={actions.handleReviewAccept}
          onReject={actions.handleReviewReject}
        />

        <DashboardSection spanClassName="col-span-12" eyebrow="Budget" title="Budget vs actual">
          <BudgetProgressCard period={activeBudgetPeriod} />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12 md:col-span-6"
          cardClassName="h-full border-t-2 border-t-border"
          eyebrow="Display"
          title="Currency controls"
        >
          <CurrencyControls
            viewMode={viewMode}
            onViewModeChange={actions.setViewMode}
            onRateUpdated={actions.refreshDashboard}
          />
        </DashboardSection>

        <DashboardSection
          spanClassName="col-span-12"
          eyebrow="Ledger"
          title="Recent transactions"
          description={
            activeMonth ? `Showing transactions for ${monthLabel(activeMonth)}.` : undefined
          }
          contentClassName="flex flex-col gap-3"
        >
          <TransactionList
            transactions={transactions}
            activeMonth={activeMonth}
            viewMode={viewMode}
          />
        </DashboardSection>
      </main>
    </div>
  );
}
