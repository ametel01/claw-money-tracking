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
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-budgets-api-'))
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

test('budget period routes create, upsert, and delete targets', async (t) => {
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

  const period = await requestJson<{
    id: number
    month: string
    budgetName: string
    currency: string
    targets: Array<{ id: number }>
  }>(`${baseUrl}/api/expenses/budget-periods`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      month: '2026-03',
      budgetName: 'Household',
      currency: 'PHP',
    }),
  })

  assert.equal(period.month, '2026-03')
  assert.equal(period.budgetName, 'Household')
  assert.equal(period.currency, 'PHP')
  assert.deepEqual(period.targets, [])

  const categories = await requestJson<Array<{ id: number; name: string; kind: string }>>(
    `${baseUrl}/api/expenses/categories`
  )
  const groceries = categories.find((category) => category.name === 'Groceries')
  assert.ok(groceries)

  const upserted = await requestJson<{
    id: number
    targets: Array<{ id: number; categoryId: number; categoryName: string; targetAmount: number }>
  }>(`${baseUrl}/api/expenses/budget-periods/${period.id}/targets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      categoryId: groceries?.id,
      targetAmount: 4200,
    }),
  })

  assert.equal(upserted.id, period.id)
  assert.deepEqual(upserted.targets, [
    {
      id: upserted.targets[0]?.id ?? 0,
      categoryId: groceries?.id,
      categoryName: 'Groceries',
      targetAmount: 4200,
      actualAmount: 0,
      remainingAmount: 4200,
    },
  ])

  const deleted = await requestJson<{ id: number; targets: Array<unknown> }>(
    `${baseUrl}/api/expenses/budget-targets/${upserted.targets[0]?.id}`,
    {
      method: 'DELETE',
    }
  )

  assert.equal(deleted.id, period.id)
  assert.deepEqual(deleted.targets, [])
})
