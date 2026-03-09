import { getOverview, getTransactions, toErrorMessage } from '@/api/expenses'
import { CategoryPie } from '@/components/CategoryPie'
import { CurrencyControls } from '@/components/CurrencyControls'
import { ImportForm } from '@/components/ImportForm'
import { KpiCards } from '@/components/KpiCards'
import { LineChart } from '@/components/LineChart'
import { MonthTabs } from '@/components/MonthTabs'
import { TransactionList } from '@/components/TransactionList'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { buildDashboardAnalytics, buildSpendingPaceChart } from '@/lib/analytics'
import { monthLabel } from '@/lib/format'
import type {
  CurrencyViewMode,
  DashboardAnalytics,
  OverviewResponse,
  TransactionRecord,
} from '@/types'
import { useCallback, useEffect, useState } from 'react'

interface DashboardState {
  overview: OverviewResponse | null
  transactions: TransactionRecord[]
  analytics: DashboardAnalytics
  activeMonth: string | null
  viewMode: CurrencyViewMode
  loadStatus: { tone: 'loading' | 'success' | 'error'; message: string }
}

const EMPTY_ANALYTICS: DashboardAnalytics = {
  months: [],
  pieSegments: [],
}

export function App() {
  const [state, setState] = useState<DashboardState>({
    overview: null,
    transactions: [],
    analytics: EMPTY_ANALYTICS,
    activeMonth: null,
    viewMode: 'home',
    loadStatus: { tone: 'loading', message: 'Loading dashboard…' },
  })

  const refreshDashboard = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loadStatus: { tone: 'loading', message: 'Loading dashboard…' },
    }))

    try {
      const [overview, transactions] = await Promise.all([getOverview(), getTransactions()])
      const analytics = buildDashboardAnalytics(transactions)
      const firstMonth = analytics.months[0]?.key ?? null

      setState((prev) => ({
        ...prev,
        overview,
        transactions,
        analytics,
        activeMonth:
          prev.activeMonth && analytics.months.some((m) => m.key === prev.activeMonth)
            ? prev.activeMonth
            : firstMonth,
        loadStatus: {
          tone: 'success',
          message: `Loaded ${transactions.length} transactions.`,
        },
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loadStatus: { tone: 'error', message: toErrorMessage(error) },
      }))
    }
  }, [])

  useEffect(() => {
    void refreshDashboard()
  }, [refreshDashboard])

  const { overview, transactions, analytics, activeMonth, viewMode, loadStatus } = state
  const loading = loadStatus.tone === 'loading'
  const lineChartModel = buildSpendingPaceChart(transactions, activeMonth)

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
        <p
          className={
            loadStatus.tone === 'error'
              ? 'text-xs text-destructive sm:text-right'
              : loadStatus.tone === 'success'
                ? 'text-xs text-[var(--color-success)] sm:text-right'
                : 'text-xs text-muted-foreground sm:text-right'
          }
          aria-live="polite"
        >
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
              <CategoryPie segments={analytics.pieSegments} />
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
              <ImportForm onImported={refreshDashboard} />
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
                months={analytics.months}
                activeMonth={activeMonth}
                onMonthChange={(month) => setState((prev) => ({ ...prev, activeMonth: month }))}
              />
              <LineChart model={lineChartModel} />
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
  )
}
