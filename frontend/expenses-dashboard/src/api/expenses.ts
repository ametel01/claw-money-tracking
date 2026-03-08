import type {
  ApiStatusResponse,
  BackfillFxResponse,
  ImportPdfResponse,
  OverviewResponse,
  TransactionRecord,
} from '../types'

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}`

    throw new HttpError(errorMessage, response.status)
  }

  return payload as T
}

export function getOverview(): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>('/api/expenses/overview')
}

export function getTransactions(limit = 400): Promise<TransactionRecord[]> {
  return requestJson<TransactionRecord[]>(`/api/expenses/transactions?limit=${limit}`)
}

export function updateUsdPhpRate(rate: number): Promise<ApiStatusResponse> {
  return requestJson<ApiStatusResponse>('/api/expenses/fx-rate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base: 'USD',
      quote: 'PHP',
      rate,
    }),
  })
}

export function backfillUsdPhp(): Promise<BackfillFxResponse> {
  return requestJson<BackfillFxResponse>('/api/expenses/fx-backfill', {
    method: 'POST',
  })
}

export function importPdfStatement(accountName: string, file: File): Promise<ImportPdfResponse> {
  const formData = new FormData()
  formData.append('accountName', accountName)
  formData.append('file', file)

  return requestJson<ImportPdfResponse>('/api/expenses/import-pdf', {
    method: 'POST',
    body: formData,
  })
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unexpected request failure'
}
