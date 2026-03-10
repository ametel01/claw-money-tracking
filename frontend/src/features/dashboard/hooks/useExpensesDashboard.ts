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
  rejectImportRow,
  toErrorMessage,
} from '@/api/expenses';
import { categoryBreakdownToPieSegments, monthlySummaryToMonthTabs } from '@/lib/analytics';
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
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  resolveSelectedMonth,
  selectActiveBudgetPeriod,
  selectLatestBatchSummary,
} from '../lib/dashboardSelectors';
import {
  type DashboardLoadStatus,
  buildDashboardLoadedMessage,
  buildDashboardLoadingMessage,
} from '../lib/dashboardStatus';

const TRANSACTION_PAGE_SIZE = 50000;

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

export interface ExpensesDashboardState {
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
  loadStatus: DashboardLoadStatus;
}

type ExpensesDashboardStateUpdate = Pick<
  ExpensesDashboardState,
  | 'overview'
  | 'transactions'
  | 'months'
  | 'pieSegments'
  | 'lineChartModel'
  | 'cashFlow'
  | 'merchantLeaderboard'
  | 'latestImportBatch'
  | 'budgetPeriods'
  | 'recurringInsights'
  | 'activeMonth'
  | 'loadStatus'
>;

interface MonthDataBundle {
  transactions: TransactionRecord[];
  pieSegments: PieSegment[];
  lineChartModel: LineChartModel;
  merchantLeaderboard: MerchantLeaderboardItem[];
}

interface BaseDashboardData {
  overview: OverviewResponse;
  months: MonthSummary[];
  cashFlow: CashFlowPoint[];
  latestImportBatchId: number | null;
  budgetPeriods: BudgetPeriodRecord[];
}

type ExpensesDashboardAction =
  | { type: 'dashboard/load-started'; message: string }
  | { type: 'dashboard/load-succeeded'; payload: ExpensesDashboardStateUpdate }
  | { type: 'dashboard/load-failed'; message: string }
  | { type: 'dashboard/budget-period-upserted'; period: BudgetPeriodRecord }
  | { type: 'dashboard/recurring-insights-updated'; recurringInsights: RecurringInsights | null }
  | { type: 'dashboard/month-selected'; month: string }
  | { type: 'dashboard/review-started'; rowId: number }
  | { type: 'dashboard/review-finished' }
  | { type: 'dashboard/view-mode-changed'; viewMode: CurrencyViewMode };

export interface UseExpensesDashboardResult {
  state: ExpensesDashboardState;
  loading: boolean;
  activeBudgetPeriod: BudgetPeriodRecord | null;
  latestBatchSummary: string | undefined;
  actions: {
    refreshDashboard: () => Promise<void>;
    handleMonthChange: (month: string) => Promise<void>;
    handleReviewAccept: (rowId: number) => Promise<void>;
    handleReviewReject: (rowId: number) => Promise<void>;
    upsertBudgetPeriod: (period: BudgetPeriodRecord) => void;
    refreshRecurringInsights: () => Promise<void>;
    setViewMode: (mode: CurrencyViewMode) => void;
  };
}

const INITIAL_STATE: ExpensesDashboardState = {
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
};

export function upsertBudgetPeriodList(
  periods: BudgetPeriodRecord[],
  nextPeriod: BudgetPeriodRecord,
): BudgetPeriodRecord[] {
  const existingIndex = periods.findIndex((period) => period.id === nextPeriod.id);
  const mergedPeriods =
    existingIndex === -1
      ? [...periods, nextPeriod]
      : periods.map((period, index) => (index === existingIndex ? nextPeriod : period));

  return mergedPeriods.sort((left, right) => {
    if (left.month === right.month) {
      return right.id - left.id;
    }

    return right.month.localeCompare(left.month);
  });
}

function dashboardReducer(
  state: ExpensesDashboardState,
  action: ExpensesDashboardAction,
): ExpensesDashboardState {
  switch (action.type) {
    case 'dashboard/load-started':
      return {
        ...state,
        loadStatus: { tone: 'loading', message: action.message },
      };
    case 'dashboard/load-succeeded':
      return {
        ...state,
        ...action.payload,
      };
    case 'dashboard/load-failed':
      return {
        ...state,
        loadStatus: { tone: 'error', message: action.message },
      };
    case 'dashboard/budget-period-upserted':
      return {
        ...state,
        budgetPeriods: upsertBudgetPeriodList(state.budgetPeriods, action.period),
      };
    case 'dashboard/recurring-insights-updated':
      return {
        ...state,
        recurringInsights: action.recurringInsights,
      };
    case 'dashboard/month-selected':
      return {
        ...state,
        activeMonth: action.month,
        loadStatus: { tone: 'loading', message: buildDashboardLoadingMessage(action.month) },
      };
    case 'dashboard/review-started':
      return {
        ...state,
        busyReviewRowId: action.rowId,
      };
    case 'dashboard/review-finished':
      return {
        ...state,
        busyReviewRowId: null,
      };
    case 'dashboard/view-mode-changed':
      return {
        ...state,
        viewMode: action.viewMode,
      };
    default:
      return state;
  }
}

async function loadMonthData(month: string | null): Promise<MonthDataBundle> {
  const [transactions, breakdown, lineChartModel, merchantLeaderboard] = await Promise.all([
    getTransactions(TRANSACTION_PAGE_SIZE, month),
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
}

async function loadBaseDashboardData(): Promise<BaseDashboardData> {
  const [overview, monthlySummary, cashFlow, latestBatches, budgetPeriods] = await Promise.all([
    getOverview(),
    getMonthlyAnalyticsSummary(),
    getCashFlow(),
    getImportBatches(1),
    getBudgetPeriods(),
  ]);

  return {
    overview,
    months: monthlySummaryToMonthTabs(monthlySummary),
    cashFlow,
    latestImportBatchId: latestBatches[0]?.id ?? null,
    budgetPeriods,
  };
}

async function loadLatestImportBatch(batchId: number | null): Promise<ImportBatchDetail | null> {
  if (!batchId) {
    return null;
  }

  return getImportBatch(batchId);
}

export function useExpensesDashboard(): UseExpensesDashboardResult {
  const activeMonthRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const [state, dispatch] = useReducer(dashboardReducer, INITIAL_STATE);

  const refreshDashboard = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    dispatch({
      type: 'dashboard/load-started',
      message: buildDashboardLoadingMessage(),
    });

    try {
      const baseData = await loadBaseDashboardData();
      const selectedMonth = resolveSelectedMonth(baseData.months, activeMonthRef.current);
      const [monthData, latestImportBatch, recurringInsights] = await Promise.all([
        loadMonthData(selectedMonth),
        loadLatestImportBatch(baseData.latestImportBatchId),
        getRecurringInsights(selectedMonth ?? undefined),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      activeMonthRef.current = selectedMonth;
      dispatch({
        type: 'dashboard/load-succeeded',
        payload: {
          overview: baseData.overview,
          transactions: monthData.transactions,
          months: baseData.months,
          pieSegments: monthData.pieSegments,
          lineChartModel: monthData.lineChartModel,
          cashFlow: baseData.cashFlow,
          merchantLeaderboard: monthData.merchantLeaderboard,
          latestImportBatch,
          budgetPeriods: baseData.budgetPeriods,
          recurringInsights,
          activeMonth: selectedMonth,
          loadStatus: {
            tone: 'success',
            message: buildDashboardLoadedMessage(selectedMonth, monthData.transactions.length),
          },
        },
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      dispatch({
        type: 'dashboard/load-failed',
        message: toErrorMessage(error),
      });
    }
  }, []);

  const handleMonthChange = useCallback(
    async (month: string) => {
      const requestId = ++requestIdRef.current;
      activeMonthRef.current = month;
      dispatch({ type: 'dashboard/month-selected', month });

      try {
        const [monthData, recurringInsights] = await Promise.all([
          loadMonthData(month),
          getRecurringInsights(month),
        ]);

        if (requestId !== requestIdRef.current) {
          return;
        }

        dispatch({
          type: 'dashboard/load-succeeded',
          payload: {
            overview: state.overview,
            transactions: monthData.transactions,
            months: state.months,
            pieSegments: monthData.pieSegments,
            lineChartModel: monthData.lineChartModel,
            cashFlow: state.cashFlow,
            merchantLeaderboard: monthData.merchantLeaderboard,
            latestImportBatch: state.latestImportBatch,
            budgetPeriods: state.budgetPeriods,
            recurringInsights,
            activeMonth: month,
            loadStatus: {
              tone: 'success',
              message: buildDashboardLoadedMessage(month, monthData.transactions.length),
            },
          },
        });
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        dispatch({
          type: 'dashboard/load-failed',
          message: toErrorMessage(error),
        });
      }
    },
    [state.budgetPeriods, state.cashFlow, state.latestImportBatch, state.months, state.overview],
  );

  const handleReviewAction = useCallback(
    async (rowId: number, action: 'accept' | 'reject') => {
      dispatch({ type: 'dashboard/review-started', rowId });

      try {
        if (action === 'accept') {
          await acceptImportRow(rowId);
        } else {
          await rejectImportRow(rowId);
        }

        await refreshDashboard();
      } catch (error) {
        dispatch({
          type: 'dashboard/load-failed',
          message: toErrorMessage(error),
        });
      } finally {
        dispatch({ type: 'dashboard/review-finished' });
      }
    },
    [refreshDashboard],
  );

  const handleReviewAccept = useCallback(
    async (rowId: number) => handleReviewAction(rowId, 'accept'),
    [handleReviewAction],
  );

  const handleReviewReject = useCallback(
    async (rowId: number) => handleReviewAction(rowId, 'reject'),
    [handleReviewAction],
  );

  const upsertBudgetPeriod = useCallback((period: BudgetPeriodRecord) => {
    dispatch({ type: 'dashboard/budget-period-upserted', period });
  }, []);

  const refreshRecurringInsights = useCallback(async () => {
    const recurringInsights = await getRecurringInsights(activeMonthRef.current ?? undefined);
    dispatch({
      type: 'dashboard/recurring-insights-updated',
      recurringInsights,
    });
  }, []);

  const setViewMode = useCallback((mode: CurrencyViewMode) => {
    dispatch({ type: 'dashboard/view-mode-changed', viewMode: mode });
  }, []);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  return {
    state,
    loading: state.loadStatus.tone === 'loading',
    activeBudgetPeriod: selectActiveBudgetPeriod(state.budgetPeriods, state.activeMonth),
    latestBatchSummary: selectLatestBatchSummary(state.latestImportBatch),
    actions: {
      refreshDashboard,
      handleMonthChange,
      handleReviewAccept,
      handleReviewReject,
      upsertBudgetPeriod,
      refreshRecurringInsights,
      setViewMode,
    },
  };
}
