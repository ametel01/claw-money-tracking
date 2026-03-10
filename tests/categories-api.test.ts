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
  const root = mkdtempSync(path.join(os.tmpdir(), 'claw-money-tracking-categories-'))
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

test('categories route returns seeded category ids, names, and kinds', async (t) => {
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

  const categories = await requestJson<Array<{ id: number; name: string; kind: string }>>(
    `${baseUrl}/api/expenses/categories`
  )

  assert.ok(categories.length > 0)
  assert.deepEqual(
    categories.slice(0, 4).map((category) => ({
      name: category.name,
      kind: category.kind,
      hasId: category.id > 0,
    })),
    [
      { name: 'Bills', kind: 'expense', hasId: true },
      { name: 'Dining', kind: 'expense', hasId: true },
      { name: 'Fees', kind: 'expense', hasId: true },
      { name: 'Fitness', kind: 'expense', hasId: true },
    ]
  )

  const salary = categories.find((category) => category.name === 'Salary')
  assert.deepEqual(salary, {
    id: 15,
    name: 'Salary',
    kind: 'income',
  })

  const transfer = categories.find((category) => category.name === 'Transfer')
  assert.deepEqual(transfer, {
    id: 16,
    name: 'Transfer',
    kind: 'transfer',
  })
})
