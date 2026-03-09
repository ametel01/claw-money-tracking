# Implementation Plan: PDF-First Expense Tracker

Date: 2026-03-09

Based on: `local-docs/pdf-first-expense-app-research.md`

## Planning rules for this repo

- Change the backend contract before changing the dashboard.
- Move analytics off the client before adding new charts.
- Make every import outcome observable in the database and API.
- Do not start a later phase until the validation for the current phase passes.

## Current constraints to preserve

- PDF import is the only ingestion path: `POST /api/expenses/import-pdf` in `server/index.ts`.
- The import pipeline lives in `ExpensesService.importPdfStatement()` in `server/expenses-service.ts`.
- The dashboard currently derives charts from `getTransactions()` plus `buildDashboardAnalytics()` and `buildSpendingPaceChart()` in `frontend/src/App.tsx` and `frontend/src/lib/analytics.ts`.
- The current transaction API is capped at 400 rows in `frontend/src/api/expenses.ts`, which means local analytics will become wrong as history grows.

## Target outcome

Deliver the first production-worthy slice of a PDF-first finance tracker in this order:

1. trustworthy import review
2. merchant-aware structured transactions
3. server-side analytics
4. actionable dashboard cards
5. budgeting foundation
6. recurring detection

## Phase 0: Baseline and safety rails

### Step 0.1: Freeze the current behavior with tests **COMPLETED**

Files:

- `tests/expenses-service.test.ts`
- `tests/dashboard-analytics.test.ts`
- `server/expenses-service.ts`

Work:

- Add regression tests for the known gaps before fixing them:
  - raw import rows remain `parsed`
  - `pickCategory()` ignores `account_id`
  - business-key dedupe ignores `account_id`
  - `backfillFx()` rewrites all rows for a currency
- Keep these tests narrow and data-driven so they can be updated when the intended behavior changes.

Validation:

- Run `bun run test`.
- Confirm existing fixture parsing still passes for all 5 statement formats.

Failure modes:

- If these tests are skipped, later refactors can silently change import semantics.
- If test setup keeps using the real repo database instead of temp workspaces, results will be nondeterministic.

## Phase 1: Make PDF import trustworthy

### Step 1.1: Expand raw import row capture so review is possible **COMPLETED**

Files:

- `expenses/schema.sql`
- `server/expenses-service.ts`
- `tests/expenses-service.test.ts`

Work:

- Extend `exp_import_rows_raw` with fields needed for review:
  - `posted_date`
  - `merchant_candidate`
  - `reference_text`
  - `parse_notes`
  - `transaction_id`
- Keep `status` on the existing enum and start using `accepted`, `duplicate`, and `needs_review` during import.
- In `ExpensesService.importPdfStatement()`:
  - stop inserting raw rows as permanently `parsed`
  - record the actual outcome for every parsed entry
  - link accepted rows to the inserted transaction when available
- Introduce an internal parsed-row shape instead of passing only `tx_date`, `description`, `amount`, `confidence`.

Concrete touchpoints:

- The current raw-row insert is the `rawRowStatement` block in `server/expenses-service.ts`.
- The duplicate skip currently happens before any row status update.

Validation:

- Add tests that import a file twice and assert the second batch marks rows as `duplicate`.
- Add tests that low-confidence or incomplete parsed rows become `needs_review`.
- Run `bun run test`.

Failure modes:

- If schema changes are not backward-compatible, existing local databases will fail on startup.
- If `transaction_id` is added without nullable semantics, old rows will break inserts.

### Step 1.2: Add import review API endpoints **COMPLETED**

Files:

- `server/index.ts`
- `server/expenses-service.ts`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`
- `tests/expenses-service.test.ts`

Work:

- Add backend endpoints for:
  - `GET /api/expenses/import-batches`
  - `GET /api/expenses/import-batches/:id`
  - `POST /api/expenses/import-rows/:id/accept`
  - `POST /api/expenses/import-rows/:id/reject`
- Keep the first version minimal:
  - list batches
  - inspect raw rows and statuses
  - accept or reject a row already captured in `exp_import_rows_raw`
- Implement service methods first, then route handlers.
- Return explicit counts by status so the UI can summarize review backlog.

Validation:

- Add route/service tests for batch listing and row state transitions.
- Manually import one fixture and verify batch totals match raw-row statuses.

Failure modes:

- If accept/reject mutates transactions without transaction boundaries, review actions can leave the DB half-updated.
- If route payloads are untyped in the frontend, UI work will drift from the API contract.

### Step 1.3: Improve parser observability before adding more bank formats **COMPLETED**

Files:

- `server/expenses-service.ts`
- `tests/fixtures/statements/*`
- `tests/expenses-service.test.ts`

Work:

- Preserve parser profile metadata during import so a batch knows which parser matched.
- Add parse notes when a row is accepted by fallback logic instead of a high-confidence parser.
- Add a fixture and parser coverage test for every statement format that is actually in active use, not just the current redacted samples.

Validation:

- Run `bun run test`.
- Confirm each parser path is exercised by at least one fixture.

Failure modes:

- If new formats are added without fixtures, imports will look successful but create noisy review queues.

## Phase 2: Make transactions structured

### Step 2.1: Start using `exp_merchants` **COMPLETED**

Files:

- `server/expenses-service.ts`
- `expenses/schema.sql`
- `tests/expenses-service.test.ts`

Work:

- Add merchant extraction helpers in `server/expenses-service.ts`.
- Resolve a normalized merchant name during import, then upsert into `exp_merchants`.
- Store the resulting `merchant_id` on accepted transactions.
- Keep original `description` unchanged for auditability.

Concrete touchpoints:

- `exp_merchants` already exists in `expenses/schema.sql`.
- `exp_transactions.merchant_id` already exists but is never populated.

Validation:

- Add tests that repeated descriptions with spelling/casing differences resolve to one merchant row.
- Add tests that transaction descriptions remain unchanged while `merchant_id` is populated.

Failure modes:

- Over-aggressive normalization will merge distinct merchants.
- Writing normalized merchant names back into `description` will destroy raw import fidelity.

### Step 2.2: Honor account-scoped categorization rules **COMPLETED**

Files:

- `server/expenses-service.ts`
- `tests/expenses-service.test.ts`

Work:

- Change `pickCategory()` to accept `accountId`.
- Update the rule query to prefer matching `account_id = ?` rules before global rules where `account_id IS NULL`.
- Update every `pickCategory()` call site in the import and review paths.

Concrete touchpoints:

- The current `pickCategory()` query ignores `exp_categorization_rules.account_id`.
- The current call site is inside `importPdfStatement()`.

Validation:

- Add tests with two accounts sharing the same description but requiring different categories.
- Run `bun run test`.

Failure modes:

- If rule precedence is undefined, identical patterns will produce unstable categorization.

### Step 2.3: Fix dedupe semantics to include account scope **COMPLETED**

Files:

- `server/expenses-service.ts`
- `tests/expenses-service.test.ts`

Work:

- Update `transactionExists()` so business-key dedupe includes `account_id`.
- Update `buildSourceHash()` or the duplicate decision rules so cross-account imports do not collide.
- Keep schema-level `UNIQUE(source_hash)` aligned with the new hash input.

Validation:

- Add tests proving identical transactions in different accounts can coexist.
- Add tests proving duplicate imports into the same account are still blocked.

Failure modes:

- If only the business-key check is fixed but `source_hash` is not, SQLite uniqueness errors will still drop valid rows.

### Step 2.4: Add user-generated categorization rules from corrections

Files:

- `server/index.ts`
- `server/expenses-service.ts`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`
- `tests/expenses-service.test.ts`

Work:

- Add a small rule-management API:
  - create rule from corrected transaction
  - list active rules
  - disable rule
- Keep rule creation explicit; do not auto-learn from every edit yet.

Validation:

- Add tests proving a created rule affects subsequent imports.
- Manually correct one transaction and verify the next import applies the rule.

Failure modes:

- If rules are auto-created from noisy merchant strings, the category system will degrade quickly.

## Phase 3: Move analytics to the server

### Step 3.1: Add monthly analytics endpoints

Files:

- `server/index.ts`
- `server/expenses-service.ts`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`
- `tests/dashboard-analytics.test.ts`

Work:

- Add server endpoints for:
  - `GET /api/expenses/analytics/monthly-summary`
  - `GET /api/expenses/analytics/category-breakdown`
  - `GET /api/expenses/analytics/cash-flow`
  - `GET /api/expenses/analytics/merchant-leaderboard`
- Use SQL aggregates from the full transaction table instead of the `getTransactions(limit = 400)` pattern.
- Keep the current client analytics code only until the UI is migrated.

Concrete touchpoints:

- `server/index.ts` currently has no analytics endpoints beyond `/overview`.
- `frontend/src/App.tsx` currently calls `getTransactions()` and builds analytics locally.

Validation:

- Add tests for SQL aggregate outputs using seeded transactions across multiple months.
- Verify results still match existing spending-pace expectations for the same fixture set.

Failure modes:

- If new analytics endpoints compute from `amount` instead of `amount_home`, multi-currency dashboards will regress.
- If query filters are inconsistent across endpoints, cards will disagree with each other.

### Step 3.2: Migrate the dashboard off client-only aggregates

Files:

- `frontend/src/App.tsx`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`
- `frontend/src/lib/analytics.ts`

Work:

- Replace local `buildDashboardAnalytics(transactions)` usage with server responses.
- Keep `buildSpendingPaceChart()` only if its input is upgraded to the full month data it needs; otherwise move that model to the backend too.
- Reduce `getTransactions()` to a ledger concern only.

Validation:

- Run `bun run typecheck`.
- Run `bun run test`.
- Manual check: dashboard totals should remain stable when transaction count exceeds 400.

Failure modes:

- If the UI mixes server aggregates with a truncated local ledger, charts and transaction lists will contradict each other.

## Phase 4: Build the actionable dashboard core

### Step 4.1: Add the first three high-value cards

Files:

- `frontend/src/App.tsx`
- `frontend/src/components/`
- `frontend/src/types.ts`
- `frontend/src/api/expenses.ts`

Work:

- Add cards for:
  - monthly cash flow
  - merchant leaderboard
  - recurring charges preview
- Keep the current layout style and component system.
- Reuse `Card` primitives already used by `KpiCards`, `CategoryPie`, and `TransactionList`.

Validation:

- Run `bun run typecheck`.
- Manually verify desktop and mobile rendering.
- Confirm empty states are explicit when no recurring series exist yet.

Failure modes:

- If recurring preview ships before merchant normalization, results will be noisy and not trustworthy.

### Step 4.2: Add review visibility to the dashboard

Files:

- `frontend/src/App.tsx`
- `frontend/src/components/ImportForm.tsx`
- new review-focused component files under `frontend/src/components/`

Work:

- Surface the latest import batch status next to the PDF upload flow.
- Add a review queue section or panel for `needs_review` and `duplicate` rows.
- Allow the user to accept/reject rows without leaving the dashboard.

Validation:

- Manual flow test:
  - import PDF
  - see batch counts
  - accept one row
  - confirm metrics update after refresh

Failure modes:

- If review actions do not trigger a data refresh, the UI will look broken even when the database is correct.

## Phase 5: Add budgeting foundations

### Step 5.1: Create budget tables and API

Files:

- `expenses/schema.sql`
- `server/index.ts`
- `server/expenses-service.ts`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`

Work:

- Add:
  - `exp_budgets`
  - `exp_budget_periods`
  - `exp_budget_targets`
- Model budgets around category-level monthly cash-flow targets in home currency.
- Add CRUD endpoints for budget periods and category targets.

Validation:

- Add service tests for creating a budget period and computing actual-vs-target totals.
- Run `bun run test`.

Failure modes:

- If budget rows are stored in account currency instead of a normalized home currency, cross-account reporting will become inconsistent.

### Step 5.2: Add budget-vs-actual dashboard views

Files:

- `frontend/src/App.tsx`
- new budget UI components in `frontend/src/components/`

Work:

- Add category progress bars for current-month budget vs actual.
- Use server aggregates only; do not rebuild category totals in the browser.

Validation:

- Manual check with seeded categories above and below target.

Failure modes:

- If uncategorized spend is omitted, budgets will look better than reality.

## Phase 6: Add recurring detection

### Step 6.1: Persist recurring series

Files:

- `expenses/schema.sql`
- `server/expenses-service.ts`
- `server/index.ts`
- `tests/expenses-service.test.ts`

Work:

- Add:
  - `exp_recurring_series`
  - `exp_recurring_occurrences`
- Detect candidates from:
  - normalized merchant
  - amount tolerance
  - cadence regularity
- Keep this as a batch recomputation job or explicit service call first; avoid hidden side effects inside import.

Validation:

- Add tests with monthly and annual recurring examples.
- Verify false positives remain low on transfer-like rows.

Failure modes:

- If recurring detection runs on raw descriptions instead of merchant-normalized data, the series table will fragment badly.

### Step 6.2: Expose recurring insights in the dashboard

Files:

- `frontend/src/App.tsx`
- recurring insight components under `frontend/src/components/`
- `frontend/src/api/expenses.ts`

Work:

- Show:
  - next expected recurring charges
  - likely subscriptions
  - projected remaining fixed spend this month

Validation:

- Manual check with seeded recurring data across two or more months.

Failure modes:

- If the UI cannot explain why a row is considered recurring, user trust will be low.

## Deferred until the above is stable

- tags
- split transactions
- hierarchical categories
- anomaly detection
- AI summaries
- net worth tracking

Reason:

- None of these are trustworthy until import review, merchant resolution, and server-side analytics are stable.

## Recommended delivery slices

### Slice A: Trust the import

- schema update for raw-row review fields
- import status handling
- batch/review APIs
- tests for duplicate and review outcomes

Exit criteria:

- Every parsed row ends in `accepted`, `duplicate`, `rejected`, or `needs_review`.

### Slice B: Structure the ledger

- merchant resolution
- account-aware categorization
- account-scoped dedupe
- rule-management API

Exit criteria:

- Imported transactions have stable merchant identities and categorization behaves differently per account when configured.

### Slice C: Trust the dashboard

- analytics endpoints
- App migration to server aggregates
- cash-flow, merchant, recurring cards

Exit criteria:

- Dashboard metrics remain correct after transaction count exceeds 400 rows.

## Definition of done for the first milestone

The first milestone is complete when all of the following are true:

- PDF imports produce reviewable batch records with explicit row outcomes.
- Merchants are populated and used for downstream analytics.
- Categorization rules honor `account_id`.
- Duplicate detection no longer collides across accounts.
- The dashboard no longer depends on a 400-row local transaction cap for charts.
- `bun run test` and `bun run typecheck` pass.
