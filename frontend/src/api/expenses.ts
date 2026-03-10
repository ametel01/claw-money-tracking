import type {
  ApiStatusResponse,
  BackfillFxResponse,
  BudgetPeriodRecord,
  CashFlowPoint,
  CategorizationRuleRecord,
  CategoryRecord,
  CategoryBreakdownItem,
  FxRateRecord,
  ImportBatchDetail,
  ImportBatchSummary,
  ImportPdfResponse,
  ImportRowActionResponse,
  LineChartModel,
  MerchantLeaderboardItem,
  MonthlyAnalyticsSummary,
  OverviewResponse,
  RecurringInsights,
  TransactionRecord,
} from '../types';

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`;

    throw new HttpError(errorMessage, response.status);
  }

  return payload as T;
}

export function getOverview(): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>('/api/expenses/overview');
}

export function getFxRates(): Promise<FxRateRecord[]> {
  return requestJson<FxRateRecord[]>('/api/expenses/fx');
}

export function getCategories(): Promise<CategoryRecord[]> {
  return requestJson<CategoryRecord[]>('/api/expenses/categories');
}

export function getTransactions(limit = 400, month?: string | null): Promise<TransactionRecord[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (month) {
    query.set('month', month);
  }

  return requestJson<TransactionRecord[]>(`/api/expenses/transactions?${query.toString()}`);
}

export function getMonthlyAnalyticsSummary(limit = 12): Promise<MonthlyAnalyticsSummary[]> {
  return requestJson<MonthlyAnalyticsSummary[]>(
    `/api/expenses/analytics/monthly-summary?limit=${limit}`,
  );
}

export function getCategoryBreakdown(month?: string, limit = 8): Promise<CategoryBreakdownItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (month) {
    query.set('month', month);
  }

  return requestJson<CategoryBreakdownItem[]>(
    `/api/expenses/analytics/category-breakdown?${query.toString()}`,
  );
}

export function getCashFlow(limit = 12): Promise<CashFlowPoint[]> {
  return requestJson<CashFlowPoint[]>(`/api/expenses/analytics/cash-flow?limit=${limit}`);
}

export function getMerchantLeaderboard(
  month?: string,
  limit = 8,
): Promise<MerchantLeaderboardItem[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (month) {
    query.set('month', month);
  }

  return requestJson<MerchantLeaderboardItem[]>(
    `/api/expenses/analytics/merchant-leaderboard?${query.toString()}`,
  );
}

export function getSpendingPaceModel(month?: string | null): Promise<LineChartModel> {
  const query = new URLSearchParams();
  if (month) {
    query.set('month', month);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return requestJson<LineChartModel>(`/api/expenses/analytics/spending-pace${suffix}`);
}

export function getBudgetPeriods(): Promise<BudgetPeriodRecord[]> {
  return requestJson<BudgetPeriodRecord[]>('/api/expenses/budget-periods');
}

export function createBudgetPeriod(input: {
  month: string;
  budgetName?: string;
  currency?: string;
}): Promise<BudgetPeriodRecord> {
  return requestJson<BudgetPeriodRecord>('/api/expenses/budget-periods', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export function getBudgetPeriod(periodId: number): Promise<BudgetPeriodRecord> {
  return requestJson<BudgetPeriodRecord>(`/api/expenses/budget-periods/${periodId}`);
}

export function upsertBudgetTarget(input: {
  periodId: number;
  categoryId: number;
  targetAmount: number;
}): Promise<BudgetPeriodRecord> {
  return requestJson<BudgetPeriodRecord>(`/api/expenses/budget-periods/${input.periodId}/targets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      categoryId: input.categoryId,
      targetAmount: input.targetAmount,
    }),
  });
}

export function deleteBudgetTarget(targetId: number): Promise<BudgetPeriodRecord> {
  return requestJson<BudgetPeriodRecord>(`/api/expenses/budget-targets/${targetId}`, {
    method: 'DELETE',
  });
}

export function recomputeRecurringSeries(): Promise<{
  ok: boolean;
  seriesCount: number;
  occurrenceCount: number;
}> {
  return requestJson('/api/expenses/recurring/recompute', {
    method: 'POST',
  });
}

export function getRecurringInsights(month?: string): Promise<RecurringInsights> {
  const query = new URLSearchParams();
  if (month) {
    query.set('month', month);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return requestJson<RecurringInsights>(`/api/expenses/recurring/insights${suffix}`);
}

export function updateUsdPhpRate(rate: number): Promise<ApiStatusResponse> {
  return upsertFxRate({
    base: 'USD',
    quote: 'PHP',
    rate,
  });
}

export function upsertFxRate(input: {
  base: string;
  quote: string;
  rate: number;
  date?: string;
}): Promise<ApiStatusResponse> {
  return requestJson<ApiStatusResponse>('/api/expenses/fx-rate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export function backfillUsdPhp(): Promise<BackfillFxResponse> {
  return requestJson<BackfillFxResponse>('/api/expenses/fx-backfill', {
    method: 'POST',
  });
}

export function importPdfStatement(accountName: string, file: File): Promise<ImportPdfResponse> {
  const formData = new FormData();
  formData.append('accountName', accountName);
  formData.append('file', file);

  return requestJson<ImportPdfResponse>('/api/expenses/import-pdf', {
    method: 'POST',
    body: formData,
  });
}

export function getImportBatches(limit = 20): Promise<ImportBatchSummary[]> {
  return requestJson<ImportBatchSummary[]>(`/api/expenses/import-batches?limit=${limit}`);
}

export function getImportBatch(batchId: number): Promise<ImportBatchDetail> {
  return requestJson<ImportBatchDetail>(`/api/expenses/import-batches/${batchId}`);
}

export function acceptImportRow(rowId: number): Promise<ImportRowActionResponse> {
  return requestJson<ImportRowActionResponse>(`/api/expenses/import-rows/${rowId}/accept`, {
    method: 'POST',
  });
}

export function rejectImportRow(rowId: number): Promise<ImportRowActionResponse> {
  return requestJson<ImportRowActionResponse>(`/api/expenses/import-rows/${rowId}/reject`, {
    method: 'POST',
  });
}

export function getCategorizationRules(): Promise<CategorizationRuleRecord[]> {
  return requestJson<CategorizationRuleRecord[]>('/api/expenses/categorization-rules');
}

export function createCategorizationRuleFromTransaction(input: {
  transactionId: number;
  categoryId: number;
  accountScoped?: boolean;
  matchType?: string;
  priority?: number;
  pattern?: string;
}): Promise<CategorizationRuleRecord> {
  return requestJson<CategorizationRuleRecord>(
    '/api/expenses/categorization-rules/from-transaction',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );
}

export function disableCategorizationRule(ruleId: number): Promise<CategorizationRuleRecord> {
  return requestJson<CategorizationRuleRecord>(
    `/api/expenses/categorization-rules/${ruleId}/disable`,
    {
      method: 'POST',
    },
  );
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unexpected request failure';
}
