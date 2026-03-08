import {
  backfillUsdPhp,
  getOverview,
  getTransactions,
  importPdfStatement,
  toErrorMessage,
  updateUsdPhpRate,
} from './api/expenses'
import { buildDashboardAnalytics } from './lib/analytics'
import { renderKpis } from './render/cards'
import { renderCategoryPie, renderLineChart } from './render/charts'
import { renderMonthTabs, renderTransactions } from './render/transactions'
import type {
  CurrencyViewMode,
  DashboardAnalytics,
  OverviewResponse,
  TransactionRecord,
} from './types'

interface DashboardElements {
  appStatus: HTMLElement
  importResult: HTMLElement
  fxResult: HTMLElement
  kpis: HTMLElement
  pie: HTMLElement
  pieLegend: HTMLElement
  lineChart: SVGSVGElement
  lineLegend: HTMLElement
  monthTabs: HTMLElement
  txList: HTMLElement
  viewMode: HTMLSelectElement
  fxForm: HTMLFormElement
  usdPhpRate: HTMLInputElement
  fxBackfillButton: HTMLButtonElement
  uploadForm: HTMLFormElement
  accountName: HTMLInputElement
  pdfFile: HTMLInputElement
}

interface DashboardState {
  overview: OverviewResponse | null
  transactions: TransactionRecord[]
  analytics: DashboardAnalytics
  activeMonth: string | null
  viewMode: CurrencyViewMode
}

export class ExpensesDashboardApp {
  private readonly state: DashboardState = {
    overview: null,
    transactions: [],
    analytics: {
      months: [],
      pieSegments: [],
      lineChart: {
        weeks: [],
        labels: [],
        series: [],
        maxY: 1,
      },
    },
    activeMonth: null,
    viewMode: 'home',
  }

  constructor(private readonly elements: DashboardElements) {}

  async init(): Promise<void> {
    this.bindEvents()
    await this.refreshDashboard()
  }

  private bindEvents(): void {
    this.elements.viewMode.addEventListener('change', () => {
      this.state.viewMode = this.elements.viewMode.value as CurrencyViewMode
      this.renderTransactions()
    })

    this.elements.monthTabs.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      const button = target.closest<HTMLButtonElement>('button[data-month]')
      if (!button?.dataset.month) {
        return
      }

      this.state.activeMonth = button.dataset.month
      this.renderMonths()
      this.renderTransactions()
    })

    this.elements.fxForm.addEventListener('submit', async (event) => {
      event.preventDefault()

      const rate = Number(this.elements.usdPhpRate.value || 0)
      if (!Number.isFinite(rate) || rate <= 0) {
        this.setStatus(this.elements.fxResult, 'Enter a valid USD/PHP rate.', 'error')
        return
      }

      await this.runAction(this.elements.fxResult, 'Saving FX rate…', async () => {
        const response = await updateUsdPhpRate(rate)
        if (!response.ok) {
          throw new Error(response.error || 'Failed to update FX rate')
        }

        await this.refreshDashboard()
        this.setStatus(this.elements.fxResult, 'USD/PHP rate updated.', 'success')
      })
    })

    this.elements.fxBackfillButton.addEventListener('click', async () => {
      await this.runAction(this.elements.fxResult, 'Backfilling historical FX…', async () => {
        const response = await backfillUsdPhp()
        if (!response.ok) {
          throw new Error(response.error || 'FX backfill failed')
        }

        await this.refreshDashboard()
        this.setStatus(
          this.elements.fxResult,
          `Backfilled FX for ${response.updated ?? 0} USD transaction(s).`,
          'success'
        )
      })
    })

    this.elements.uploadForm.addEventListener('submit', async (event) => {
      event.preventDefault()

      const accountName = this.elements.accountName.value.trim()
      const file = this.elements.pdfFile.files?.[0]

      if (!file) {
        this.setStatus(this.elements.importResult, 'Choose a PDF statement first.', 'error')
        return
      }

      await this.runAction(this.elements.importResult, 'Parsing PDF statement…', async () => {
        const response = await importPdfStatement(accountName, file)
        if (!response.ok) {
          throw new Error(response.error || 'Import failed')
        }

        this.elements.uploadForm.reset()
        await this.refreshDashboard()
        this.setStatus(
          this.elements.importResult,
          `Imported ${response.insertedTransactions ?? 0} transaction(s) from ${
            response.parsedRows ?? 0
          } parsed rows.`,
          'success'
        )
      })
    })
  }

  private async refreshDashboard(): Promise<void> {
    this.setStatus(this.elements.appStatus, 'Loading dashboard…')

    try {
      const [overview, transactions] = await Promise.all([getOverview(), getTransactions()])

      this.state.overview = overview
      this.state.transactions = transactions
      this.state.analytics = buildDashboardAnalytics(transactions)
      this.state.activeMonth = this.resolveActiveMonth()

      this.render()
      this.setStatus(
        this.elements.appStatus,
        `Loaded ${transactions.length} transactions.`,
        'success'
      )
    } catch (error) {
      this.setStatus(this.elements.appStatus, toErrorMessage(error), 'error')
      throw error
    }
  }

  private resolveActiveMonth(): string | null {
    if (this.state.analytics.months.length === 0) {
      return null
    }

    if (
      this.state.activeMonth &&
      this.state.analytics.months.some((month) => month.key === this.state.activeMonth)
    ) {
      return this.state.activeMonth
    }

    return this.state.analytics.months[0]?.key ?? null
  }

  private render(): void {
    if (this.state.overview) {
      renderKpis(this.elements.kpis, this.state.overview)
    }

    renderCategoryPie(this.elements.pie, this.elements.pieLegend, this.state.analytics.pieSegments)
    renderLineChart(
      this.elements.lineChart,
      this.elements.lineLegend,
      this.state.analytics.lineChart
    )
    this.renderMonths()
    this.renderTransactions()
  }

  private renderMonths(): void {
    renderMonthTabs(this.elements.monthTabs, this.state.analytics.months, this.state.activeMonth)
  }

  private renderTransactions(): void {
    renderTransactions(
      this.elements.txList,
      this.state.transactions,
      this.state.activeMonth,
      this.state.viewMode
    )
  }

  private async runAction(
    target: HTMLElement,
    pendingMessage: string,
    operation: () => Promise<void>
  ): Promise<void> {
    this.setStatus(target, pendingMessage)

    try {
      await operation()
    } catch (error) {
      this.setStatus(target, toErrorMessage(error), 'error')
    }
  }

  private setStatus(
    target: HTMLElement,
    message: string,
    tone: 'muted' | 'success' | 'error' = 'muted'
  ): void {
    target.textContent = message
    target.dataset.tone = tone
  }
}
