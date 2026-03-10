import { CashFlowCard } from '@/components/CashFlowCard';
import { CategoryPie } from '@/components/CategoryPie';
import { CurrencyControls } from '@/components/CurrencyControls';
import { KpiCards } from '@/components/KpiCards';
import { LineChart } from '@/components/LineChart';
import { MerchantLeaderboardCard } from '@/components/MerchantLeaderboardCard';
import { MonthTabs } from '@/components/MonthTabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BudgetSection } from '@/features/budgets/components/BudgetSection';
import { CategorizationRulesSection } from '@/features/categorization/components/CategorizationRulesSection';
import { TransactionCategorizationSection } from '@/features/categorization/components/TransactionCategorizationSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCategorizationRules } from '@/features/categorization/hooks/useCategorizationRules';
import { FxManagementSection } from '@/features/fx/components/FxManagementSection';
import { ImportReviewSection } from '@/features/imports/components/ImportReviewSection';
import { ImportWorkflowSection } from '@/features/imports/components/ImportWorkflowSection';
import { RecurringSection } from '@/features/recurring/components/RecurringSection';
import { monthLabel } from '@/lib/format';
import { useState } from 'react';
import type { UseExpensesDashboardResult } from '../hooks/useExpensesDashboard';
import { DashboardHeader } from './DashboardHeader';
import { DashboardSection } from './DashboardSection';

const WORKSPACES = [
  { value: 'overview', label: 'Overview' },
  { value: 'imports', label: 'Imports' },
  { value: 'budget', label: 'Budget' },
  { value: 'categorization', label: 'Categorization' },
  { value: 'controls', label: 'Controls' },
] as const;

export function ExpensesDashboardPage({
  state,
  loading,
  activeBudgetPeriod,
  latestBatchSummary,
  actions,
}: UseExpensesDashboardResult) {
  const categorizationRules = useCategorizationRules();
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
  const [workspace, setWorkspace] =
    useState<(typeof WORKSPACES)[number]['value']>('overview');
  const handleRuleCreated = async () => {
    await Promise.all([
      actions.refreshDashboard(),
      categorizationRules.actions.refreshRules(),
    ]);
  };

  return (
    <div className="mx-auto w-full max-w-[1320px] px-3 py-4 pb-16 sm:px-4 sm:py-6">
      <DashboardHeader status={loadStatus} />

      <main>
        <Tabs value={workspace} onValueChange={(value) => setWorkspace(value as typeof workspace)} className="gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Workspace
              </p>
              <p className="max-w-[72ch] text-sm text-muted-foreground">
                Keep the live financial snapshot up front and move imports, budgeting,
                categorization, and controls into focused workspaces.
              </p>
            </div>
            <div className="sm:hidden">
              <Select value={workspace} onValueChange={(value) => setWorkspace(value as typeof workspace)}>
                <SelectTrigger aria-label="Select dashboard workspace" className="w-full">
                  <SelectValue placeholder="Choose workspace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {WORKSPACES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <TabsList
              aria-label="Dashboard sections"
              variant="line"
              className="hidden h-auto w-full justify-start overflow-x-auto border-b border-border px-0 py-0 sm:inline-flex sm:w-fit"
            >
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="imports">Imports</TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
              <TabsTrigger value="categorization">Categorization</TabsTrigger>
              <TabsTrigger value="controls">Controls</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview">
            <div className="grid grid-cols-12 gap-4">
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
                spanClassName="col-span-12 md:col-span-6 xl:col-span-4"
                cardClassName="h-full"
                eyebrow="Cash Flow"
                title="Monthly cash flow"
              >
                <CashFlowCard points={cashFlow} activeMonth={activeMonth} />
              </DashboardSection>

              <DashboardSection
                spanClassName="col-span-12 md:col-span-6 xl:col-span-4"
                cardClassName="h-full"
                eyebrow="Merchants"
                title="Merchant leaderboard"
              >
                <MerchantLeaderboardCard merchants={merchantLeaderboard} activeMonth={activeMonth} />
              </DashboardSection>

              <DashboardSection
                spanClassName="col-span-12 md:col-span-6 xl:col-span-4"
                cardClassName="h-full"
                eyebrow="Recurring"
                title="Recurring charges preview"
              >
                <RecurringSection
                  insights={recurringInsights}
                  onInsightsReload={actions.refreshRecurringInsights}
                />
              </DashboardSection>
            </div>
          </TabsContent>

          <TabsContent value="imports">
            <div className="grid grid-cols-12 gap-4">
              <ImportWorkflowSection
                latestImportBatch={latestImportBatch}
                latestBatchSummary={latestBatchSummary}
                onImported={actions.refreshDashboard}
              />

              <ImportReviewSection
                latestImportBatch={latestImportBatch}
                busyReviewRowId={busyReviewRowId}
                onAccept={actions.handleReviewAccept}
                onReject={actions.handleReviewReject}
              />
            </div>
          </TabsContent>

          <TabsContent value="budget">
            <div className="grid grid-cols-12 gap-4">
              <DashboardSection spanClassName="col-span-12" eyebrow="Budget" title="Budget vs actual">
                <BudgetSection
                  activeMonth={activeMonth}
                  period={activeBudgetPeriod}
                  onBudgetPeriodChanged={actions.upsertBudgetPeriod}
                />
              </DashboardSection>
            </div>
          </TabsContent>

          <TabsContent value="categorization">
            <div className="grid grid-cols-12 gap-4">
              <DashboardSection
                spanClassName="col-span-12 md:col-span-6"
                cardClassName="h-full"
                eyebrow="Rules"
                title="Categorization rules"
                description="Review active transaction-matching rules and disable any that should stop applying."
              >
                <CategorizationRulesSection
                  rules={categorizationRules.rules}
                  loading={categorizationRules.loading}
                  busyRuleId={categorizationRules.busyRuleId}
                  status={categorizationRules.status}
                  onDisableRule={categorizationRules.actions.disableRule}
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
                <TransactionCategorizationSection
                  transactions={transactions}
                  activeMonth={activeMonth}
                  viewMode={viewMode}
                  onRuleCreated={handleRuleCreated}
                />
              </DashboardSection>
            </div>
          </TabsContent>

          <TabsContent value="controls">
            <div className="grid grid-cols-12 gap-4">
              <DashboardSection
                spanClassName="col-span-12 md:col-span-6"
                cardClassName="h-full border-t-2 border-t-border"
                eyebrow="Display"
                title="Currency controls"
              >
                <CurrencyControls viewMode={viewMode} onViewModeChange={actions.setViewMode} />
              </DashboardSection>

              <DashboardSection
                spanClassName="col-span-12 md:col-span-6"
                cardClassName="h-full border-t-2 border-t-border"
                eyebrow="FX"
                title="FX management"
                description="Submit manual FX rates, review rate history, and run USD/PHP transaction backfills."
              >
                <FxManagementSection onFxUpdated={actions.refreshDashboard} />
              </DashboardSection>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
