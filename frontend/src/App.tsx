import {
  acceptImportRow,
  getBudgetPeriods,
  getCashFlow,
  getCategoryBreakdown,
  getImportBatch,
  getImportBatches,
  getMerchantLeaderboard,
  getMonthlyAnalyticsSummary,
  getOverview,
  getRecurringInsights,
  getSpendingPaceModel,
  getTransactions,
  recomputeRecurringSeries,
  rejectImportRow,
  toErrorMessage,
} from '@/api/expenses';
import { BudgetProgressCard } from '@/components/BudgetProgressCard';
import { CashFlowCard } from '@/components/CashFlowCard';
import { CategoryPie } from '@/components/CategoryPie';
import { CurrencyControls } from '@/components/CurrencyControls';
import { ImportBatchStatus } from '@/components/ImportBatchStatus';
import { ImportForm } from '@/components/ImportForm';
import { ImportReviewQueue } from '@/components/ImportReviewQueue';
import { KpiCards } from '@/components/KpiCards';
import { LineChart } from '@/components/LineChart';
import { MerchantLeaderboardCard } from '@/components/MerchantLeaderboardCard';
import { MonthTabs } from '@/components/MonthTabs';
import { RecurringPreviewCard } from '@/components/RecurringPreviewCard';
import { TransactionList } from '@/components/TransactionList';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { categoryBreakdownToPieSegments, monthlySummaryToMonthTabs } from '@/lib/analytics';
import { monthLabel } from '@/lib/format';
import type {
  BudgetPeriodRecord,
  CashFlowPoint,
  CurrencyViewMode,
  ImportBatchDetail,
  LineChartModel,
  MerchantLeaderboardItem,
  MonthSummary,
  OverviewResponse,
  PieSegment,
  RecurringInsights,
  TransactionRecord,
} from '@/types';
import { useCallback, useEffect, useRef, useState } from 'react';

interface DashboardState {
  overview: OverviewResponse | null;
  transactions: TransactionRecord[];
  months: MonthSummary[];
  pieSegments: PieSegment[];
  lineChartModel: LineChartModel;
  cashFlow: CashFlowPoint[];
  merchantLeaderboard: MerchantLeaderboardItem[];
  latestImportBatch: ImportBatchDetail | null;
  busyReviewRowId: number | null;
  budgetPeriods: BudgetPeriodRecord[];
  recurringInsights: RecurringInsights | null;
  activeMonth: string | null;
  viewMode: CurrencyViewMode;
  loadStatus: { tone: 'loading' | 'success' | 'error'; message: string };
}

const EMPTY_LINE_CHART: LineChartModel = {
  monthKey: null,
  monthLabel: '',
  comparisonMonthLabel: null,
  points: [],
  maxY: 1,
  total: 0,
  comparisonTotal: null,
  comparisonToDate: null,
  projectedTotal: null,
  daysElapsed: 0,
  daysInMonth: 0,
  isCurrentMonth: false,
  largestDay: null,
};

function getLoadStatusClassName(tone: DashboardState['loadStatus']['tone']): string {
  switch (tone) {
    case 'error':
      return 'text-xs text-destructive sm:text-right';
    case 'success':
      return 'text-xs text-[var(--color-success)] sm:text-right';
    default:
      return 'text-xs text-muted-foreground sm:text-right';
  }
}

export function App() {
  const activeMonthRef = useRef<string | null>(null);
  const [state, setState] = useState<DashboardState>({
    overview: null,
    transactions: [],
    months: [],
    pieSegments: [],
    lineChartModel: EMPTY_LINE_CHART,
    cashFlow: [],
    merchantLeaderboard: [],
    latestImportBatch: null,
    busyReviewRowId: null,
    budgetPeriods: [],
    recurringInsights: null,
    activeMonth: null,
    viewMode: 'home',
    loadStatus: { tone: 'loading', message: 'Loading dashboard…' },
  });

  const loadMonthData = useCallback(async (month: string | null) => {
    const [transactions, breakdown, lineChartModel, merchantLeaderboard] = await Promise.all([
      getTransactions(50000, month),
      getCategoryBreakdown(month ?? undefined),
      getSpendingPaceModel(month),
      getMerchantLeaderboard(month ?? undefined),
    ]);

    return {
      transactions,
      pieSegments: categoryBreakdownToPieSegments(breakdown),
      lineChartModel,
      merchantLeaderboard,
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loadStatus: { tone: 'loading', message: 'Loading dashboard…' },
    }));

    try {
      const [overview, monthlySummary, cashFlow, latestBatches, budgetPeriods] = await Promise.all([
        getOverview(),
        getMonthlyAnalyticsSummary(),
        getCashFlow(),
        getImportBatches(1),
        getBudgetPeriods(),
      ]);
      const months = monthlySummaryToMonthTabs(monthlySummary);
      const selectedMonth =
        activeMonthRef.current && months.some((month) => month.key === activeMonthRef.current)
          ? activeMonthRef.current
          : (months[0]?.key ?? null);
      const [monthData, latestImportBatch] = await Promise.all([
        loadMonthData(selectedMonth),
        latestBatches[0] ? getImportBatch(latestBatches[0].id) : Promise.resolve(null),
      ]);
      await recomputeRecurringSeries();
      const recurringInsights = await getRecurringInsights(selectedMonth ?? undefined);
      activeMonthRef.current = selectedMonth;

      setState((prev) => ({
        ...prev,
        overview,
        transactions: monthData.transactions,
        months,
        pieSegments: monthData.pieSegments,
        lineChartModel: monthData.lineChartModel,
        cashFlow,
        merchantLeaderboard: monthData.merchantLeaderboard,
        latestImportBatch,
        budgetPeriods,
        recurringInsights,
        activeMonth: selectedMonth,
        loadStatus: {
          tone: 'success',
          message: `Loaded ${monthData.transactions.length} transactions for ${
            selectedMonth ? monthLabel(selectedMonth) : 'the ledger'
          }.`,
        },
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loadStatus: { tone: 'error', message: toErrorMessage(error) },
      }));
    }
  }, [loadMonthData]);

  const handleMonthChange = useCallback(
    async (month: string) => {
      activeMonthRef.current = month;
      setState((prev) => ({
        ...prev,
        activeMonth: month,
        loadStatus: { tone: 'loading', message: `Loading ${monthLabel(month)}…` },
      }));

      try {
        const [monthData, recurringInsights] = await Promise.all([
          loadMonthData(month),
          getRecurringInsights(month),
        ]);
        setState((prev) => ({
          ...prev,
          activeMonth: month,
          transactions: monthData.transactions,
          pieSegments: monthData.pieSegments,
          lineChartModel: monthData.lineChartModel,
          merchantLeaderboard: monthData.merchantLeaderboard,
          recurringInsights,
          loadStatus: {
            tone: 'success',
            message: `Loaded ${monthData.transactions.length} transactions for ${monthLabel(month)}.`,
          },
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loadStatus: { tone: 'error', message: toErrorMessage(error) },
        }));
      }
    },
    [loadMonthData],
  );

  const handleReviewAction = useCallback(
    async (rowId: number, action: 'accept' | 'reject') => {
      setState((prev) => ({ ...prev, busyReviewRowId: rowId }));

      try {
        if (action === 'accept') {
          await acceptImportRow(rowId);
        } else {
          await rejectImportRow(rowId);
        }

        await refreshDashboard();
      } catch (error) {
        setState((prev) => ({
          ...prev,
          busyReviewRowId: null,
          loadStatus: { tone: 'error', message: toErrorMessage(error) },
        }));
        return;
      }

      setState((prev) => ({ ...prev, busyReviewRowId: null }));
    },
    [refreshDashboard],
  );

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const {
    overview,
    transactions,
    months,
    pieSegments,
    activeMonth,
    viewMode,
    loadStatus,
    latestImportBatch,
    busyReviewRowId,
    budgetPeriods,
    recurringInsights,
  } = state;
  const loading = loadStatus.tone === 'loading';
  const lineChartModel = state.lineChartModel;
  const cashFlow = state.cashFlow;
  const merchantLeaderboard = state.merchantLeaderboard;
  const activeBudgetPeriod = budgetPeriods.find((period) => period.month === activeMonth) ?? null;
  const loadStatusClassName = getLoadStatusClassName(loadStatus.tone);
  const latestBatchSummary = latestImportBatch
    ? `${latestImportBatch.counts.needs_review} need review, ${latestImportBatch.counts.duplicate} duplicates in the latest batch.`
    : undefined;

  return (
    <div className="w-full max-w-[1320px] mx-auto px-4 py-6 pb-16">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 pb-6 mb-6 border-b border-border sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-[0.6rem] font-bold uppercase tracking-[0.18em] text-primary">
            Money Tracking
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Expenses Dashboard</h1>
          <p className="text-sm text-muted-foreground max-w-[56ch]">
            SQLite-backed statement imports, FX normalization, and lean visual summaries.
          </p>
        </div>
        <p className={loadStatusClassName} aria-live="polite">
          {loadStatus.message}
        </p>
      </header>

      {/* ── Dashboard Grid ── */}
      <main className="grid grid-cols-12 gap-4">
        {/* KPI Overview */}
        <section className="col-span-12">
          <Card className="border-t-2 border-t-primary">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Overview
              </CardDescription>
              <CardTitle>Live snapshot</CardTitle>
            </CardHeader>
            <CardContent>
              <KpiCards overview={overview} loading={loading} />
            </CardContent>
          </Card>
        </section>

        {/* Category Pie */}
        <section className="col-span-12 md:col-span-6">
          <Card className="h-full">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Allocation
              </CardDescription>
              <CardTitle>Category split</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryPie segments={pieSegments} />
            </CardContent>
          </Card>
        </section>

        {/* Import PDF */}
        <section className="col-span-12 md:col-span-6">
          <Card className="h-full border-t-2 border-t-[oklch(0.60_0.20_245)]">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Import
              </CardDescription>
              <CardTitle>PDF statements</CardTitle>
              <CardDescription>Upload a bank PDF to parse and import transactions.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <ImportForm
                  onImported={refreshDashboard}
                  {...(latestBatchSummary ? { latestBatchSummary } : {})}
                />
                <ImportBatchStatus batch={latestImportBatch} />
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Line Chart */}
        <section className="col-span-12">
          <Card>
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Spending Pace
              </CardDescription>
              <CardTitle>Cumulative spend by day</CardTitle>
              <CardDescription>
                Track how quickly expenses stack up in the selected month versus the prior month.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <MonthTabs
                months={months}
                activeMonth={activeMonth}
                onMonthChange={(month) => void handleMonthChange(month)}
              />
              <LineChart model={lineChartModel} />
            </CardContent>
          </Card>
        </section>

        <section className="col-span-12 md:col-span-4">
          <Card className="h-full">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Cash Flow
              </CardDescription>
              <CardTitle>Monthly cash flow</CardTitle>
            </CardHeader>
            <CardContent>
              <CashFlowCard points={cashFlow} activeMonth={activeMonth} />
            </CardContent>
          </Card>
        </section>

        <section className="col-span-12 md:col-span-4">
          <Card className="h-full">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Merchants
              </CardDescription>
              <CardTitle>Merchant leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              <MerchantLeaderboardCard merchants={merchantLeaderboard} activeMonth={activeMonth} />
            </CardContent>
          </Card>
        </section>

        <section className="col-span-12 md:col-span-4">
          <Card className="h-full">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Recurring
              </CardDescription>
              <CardTitle>Recurring charges preview</CardTitle>
            </CardHeader>
            <CardContent>
              <RecurringPreviewCard insights={recurringInsights} />
            </CardContent>
          </Card>
        </section>

        <section className="col-span-12">
          <Card>
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Review
              </CardDescription>
              <CardTitle>Import review queue</CardTitle>
              <CardDescription>
                Accept or reject `needs_review` and `duplicate` rows from the latest import batch.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImportReviewQueue
                batch={latestImportBatch}
                busyRowId={busyReviewRowId}
                onAccept={(rowId) => handleReviewAction(rowId, 'accept')}
                onReject={(rowId) => handleReviewAction(rowId, 'reject')}
              />
            </CardContent>
          </Card>
        </section>

        <section className="col-span-12">
          <Card>
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Budget
              </CardDescription>
              <CardTitle>Budget vs actual</CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetProgressCard period={activeBudgetPeriod} />
            </CardContent>
          </Card>
        </section>

        {/* Currency Controls */}
        <section className="col-span-12 md:col-span-6">
          <Card className="h-full border-t-2 border-t-border">
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Display
              </CardDescription>
              <CardTitle>Currency controls</CardTitle>
            </CardHeader>
            <CardContent>
              <CurrencyControls
                viewMode={viewMode}
                onViewModeChange={(mode) => setState((prev) => ({ ...prev, viewMode: mode }))}
                onRateUpdated={refreshDashboard}
              />
            </CardContent>
          </Card>
        </section>

        {/* Transactions */}
        <section className="col-span-12">
          <Card>
            <CardHeader>
              <CardDescription className="text-[0.6rem] font-bold uppercase tracking-[0.16em]">
                Ledger
              </CardDescription>
              <CardTitle>Recent transactions</CardTitle>
              {activeMonth && (
                <CardDescription>
                  Showing transactions for {monthLabel(activeMonth)}.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <TransactionList
                transactions={transactions}
                activeMonth={activeMonth}
                viewMode={viewMode}
              />
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
