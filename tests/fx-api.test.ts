import assert from 'node:assert/strict'
import { once } from 'node:events'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ExpensesService } from '../server/expenses-service'
import { createExpensesApp } from '../server/index'

const repoRoot = path.resolve(__dirname, '..')

function createWorkspace(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-fx-'))
  mkdirSync(path.join(root, 'expenses'), { recursive: true })
  copyFileSync(
    path.join(repoRoot, 'expenses', 'schema.sql'),
    path.join(root, 'expenses', 'schema.sql')
  )
  return root
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = (await response.json()) as T
  assert.equal(response.ok, true)
  return payload
}

test('fx routes list manually submitted dated currency pairs', async (t) => {
  const root = createWorkspace()
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const service = new ExpensesService(root)
  const app = createExpensesApp(service)
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    server.close()
    await once(server, 'close')
  })
  await once(server, 'listening')

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const upserted = await requestJson<{ ok: boolean }>(`${baseUrl}/api/expenses/fx-rate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base: 'EUR',
      quote: 'PHP',
      rate: 63.4821,
      date: '2026-02-19',
    }),
  })
  assert.equal(upserted.ok, true)

  const listedRates = await requestJson<
    Array<{
      base_currency: string
      quote_currency: string
      rate_date: string
      rate: number
      provider: string
    }>
  >(`${baseUrl}/api/expenses/fx`)

  const eurPhpRate = listedRates.find(
    (rate) => rate.base_currency === 'EUR' && rate.quote_currency === 'PHP'
  )

  assert.deepEqual(eurPhpRate, {
    base_currency: 'EUR',
    quote_currency: 'PHP',
    rate_date: '2026-02-19',
    rate: 63.4821,
    provider: 'manual',
  })
})
