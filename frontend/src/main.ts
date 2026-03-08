import './styles.css'

import { ExpensesDashboardApp } from './app'
import { getRequiredElement } from './lib/dom'

const app = new ExpensesDashboardApp({
  appStatus: getRequiredElement('appStatus'),
  importResult: getRequiredElement('importResult'),
  fxResult: getRequiredElement('fxResult'),
  kpis: getRequiredElement('kpis'),
  pie: getRequiredElement('catPie'),
  pieLegend: getRequiredElement('catLegend'),
  lineChart: getRequiredElement<SVGSVGElement>('lineChart'),
  lineLegend: getRequiredElement('lineLegend'),
  monthTabs: getRequiredElement('monthTabs'),
  txList: getRequiredElement('txList'),
  viewMode: getRequiredElement('viewMode'),
  fxForm: getRequiredElement('fxForm'),
  usdPhpRate: getRequiredElement('usdPhpRate'),
  fxBackfillButton: getRequiredElement('fxBackfillBtn'),
  uploadForm: getRequiredElement('uploadForm'),
  accountName: getRequiredElement('accountName'),
  pdfFile: getRequiredElement('pdfFile'),
})

void app.init().catch(() => undefined)
