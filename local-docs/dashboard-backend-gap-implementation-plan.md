# Implementation Plan: Expose Backend-Supported Features In The Dashboard

Date: 2026-03-10

## Goal

Make the expenses dashboard directly expose the backend-supported capabilities that are currently missing or only indirectly reachable from the frontend.

This plan is grounded in code inspection, not product assumptions.

## Research Summary

### Authoritative files

- `server/index.ts`
- `server/expenses-service.ts`
- `frontend/src/api/expenses.ts`
- `frontend/src/types.ts`
- `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`
- `frontend/src/components/BudgetProgressCard.tsx`
- `frontend/src/components/TransactionList.tsx`
- `frontend/src/components/CurrencyControls.tsx`
- `tests/budgets.test.ts`
- `tests/import-review-api.test.ts`

### Verified current wiring

- The dashboard currently calls only this subset of the expenses API:
  - overview, transactions, monthly summary, category breakdown, cash flow, merchant leaderboard, spending pace
  - budget period listing
  - recurring insights and recurring recompute
  - import batches, import batch detail, import row accept/reject
  - PDF import
  - USD/PHP rate update and USD/PHP backfill
- Authoritative call sites:
  - `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`
  - `frontend/src/components/ImportForm.tsx`
  - `frontend/src/components/CurrencyControls.tsx`
- The budget card is read-only. `frontend/src/components/BudgetProgressCard.tsx` only renders empty states or progress bars.
- The transaction list is read-only. `frontend/src/components/TransactionList.tsx` renders row text and amounts, with no actions.
- The frontend API client already contains unused wrappers for:
  - `createBudgetPeriod`
  - `getBudgetPeriod`
  - `upsertBudgetTarget`
  - `deleteBudgetTarget`
  - `getCategorizationRules`
  - `createCategorizationRuleFromTransaction`
  - `disableCategorizationRule`
- The backend exposes `GET /api/expenses/fx` in `server/index.ts`, but there is no frontend wrapper or UI for FX history.
- `POST /api/expenses/recurring/recompute` is not a direct user action. It is triggered implicitly inside `refreshRecurringData()` in `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`.

### Missing frontend-accessible functionality

These backend-backed capabilities are not directly available to the dashboard user today:

1. Create a budget period for a month
2. Add or update budget targets by category
3. Delete budget targets
4. View one budget period in an editor flow
5. List categorization rules
6. Create a categorization rule from a transaction
7. Disable a categorization rule
8. View FX rate history
9. Submit dated FX entries and non-USD/PHP pairs that the backend already supports
10. Trigger recurring recomputation explicitly

### Hard blockers and constraints

- Budget target mutation and categorization-rule creation both require `categoryId`, but the dashboard has no category list and transaction rows do not expose category IDs.
- There is no backend category-list endpoint today. A minimal supporting API must be added before the existing hidden budget and categorization mutations can be used from the frontend.
- `createCategorizationRuleFromTransaction()` in `server/expenses-service.ts` mutates both the transaction category and the rules table. The dashboard must refresh transaction state after rule creation or the UI will lie.
- `upsertFxRate()` in `server/expenses-service.ts` accepts `baseCurrency`, `quoteCurrency`, `rate`, and optional `rateDate`, but the current UI hardcodes USD/PHP and omits `date`.
- If recurring recompute stays in the general dashboard refresh path, adding a manual recompute button will create duplicate mutation paths and confusing load behavior.

### Manual validation already performed

- Inspected the full expenses API route surface in `server/index.ts`.
- Compared backend routes to frontend imports of `@/api/expenses`.
- Verified budget backend behavior in `tests/budgets.test.ts`.
- Verified categorization rule route behavior in `tests/import-review-api.test.ts`.
- Verified that no category-list route or frontend category type currently exists.

## Scope

This plan targets user-visible capability parity, not a one-widget-per-route mapping.

Implication:

- `GET /api/expenses/budget-periods/:id` can remain an implementation helper used by the budget editor, even if it does not get a dedicated top-level screen.
- Static redirect routes in `server/index.ts` are out of scope.

## Implementation Rules

- Add missing backend support data before adding new dashboard controls.
- Keep new functionality inside feature folders instead of re-expanding the dashboard root.
- Validate every backend contract with tests before wiring UI.
- Remove implicit mutations from dashboard refresh when introducing explicit actions.

## Phase 0: Add missing support data for the frontend

### Step 0.1: Add a categories API

**COMPLETED**

Why:

- Budget target editing and categorization rule creation cannot be implemented correctly without authoritative category IDs.

Files:

- `server/expenses-service.ts`
- `server/index.ts`
- `frontend/src/types.ts`
- `frontend/src/api/expenses.ts`
- `tests/expenses-service.test.ts` or a new `tests/categories-api.test.ts`

Work:

- Add a service method that lists categories with at least:
  - `id`
  - `name`
  - `kind`
- Add `GET /api/expenses/categories`.
- Add frontend types and a client wrapper.

Validation:

- Add an API test that asserts the categories endpoint returns seeded categories from a temp workspace.
- Run `bun run test`, `bun run typecheck`, and `bun run lint`.

Failure modes:

- If the UI synthesizes category IDs from names, budget and rule mutations will be brittle.
- If the endpoint returns only names, the frontend still cannot call the existing mutation routes safely.

### Step 0.2: Add frontend types for FX history

Files:

- `frontend/src/types.ts`
- `frontend/src/api/expenses.ts`

Work:

- Add a typed `FxRateRecord` matching `listFxRates()` output from `server/expenses-service.ts`.
- Add `getFxRates()` and a generic `upsertFxRate()` client that accepts `{ base, quote, rate, date? }`.
- Keep the existing USD/PHP convenience wrapper only if other code still needs it.

Validation:

- Run `bun run typecheck`.

Failure modes:

- If the frontend keeps only the hardcoded USD/PHP wrapper, the dashboard still cannot expose the backend's broader FX capability.

## Phase 1: Productize budget management

### Step 1.1: Build a budget editor feature instead of extending the read-only card

Files:

- `frontend/src/features/budgets/components/BudgetSection.tsx`
- `frontend/src/features/budgets/components/BudgetPeriodForm.tsx`
- `frontend/src/features/budgets/components/BudgetTargetForm.tsx`
- `frontend/src/features/budgets/components/BudgetTargetList.tsx`
- `frontend/src/features/budgets/hooks/useBudgetEditor.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`
- `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`

Work:

- Replace the passive use of `BudgetProgressCard` with a budget feature section that can:
  - create a budget period for the active month when none exists
  - add a target for a selected category
  - edit an existing target amount via upsert
  - delete a target
- Keep `BudgetProgressCard` as the read-only visual subcomponent if it still helps.
- Keep budget-specific mutation logic out of `useExpensesDashboard()` by creating a focused budget hook.

Validation:

- Manual:
  - open a month with no budget
  - create a period
  - add a target
  - reload the page and confirm the target persists
  - delete the target and confirm the visual state updates
- Automated:
  - add API-level tests for create, upsert, and delete flows if they do not already exist
  - run `bun run test`, `bun run typecheck`, `bun run lint`

Failure modes:

- If budget mutations are folded into the dashboard hook, the refactor regresses back toward a god hook.
- If target edits do not refresh the active budget period, the chart and editor will diverge.

### Step 1.2: Decide how to source the active period after mutation

Files:

- `frontend/src/features/budgets/hooks/useBudgetEditor.ts`
- `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`

Work:

- Choose one approach and keep it consistent:
  - optimistic local replacement of the active budget period from mutation responses
  - or full dashboard refresh after budget mutations
- Prefer local replacement first, because the budget mutation routes already return a full `BudgetPeriodRecord`.

Validation:

- Create and update two targets in sequence without a full page reload.

Failure modes:

- Full dashboard refresh after every target edit will make the budget section feel slow and can retrigger unrelated recurring recomputation until that path is cleaned up.

## Phase 2: Productize categorization rules

### Step 2.1: Add transaction-level category actions

Files:

- `frontend/src/components/TransactionList.tsx`
- `frontend/src/features/categorization/components/TransactionCategorizationPanel.tsx`
- `frontend/src/features/categorization/hooks/useTransactionCategorization.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`

Work:

- Add a per-transaction action in the ledger so a user can select a transaction and:
  - choose a category
  - create a rule from that transaction
  - choose account-scoped or global rule behavior
- Use the existing `transaction.id` from `TransactionRecord` plus the new categories endpoint.
- Refresh transactions and rules after rule creation.

Validation:

- Manual:
  - create a rule from a visible transaction
  - confirm the transaction category changes after refresh
  - import or locate another matching transaction and confirm the rule applies
- Automated:
  - extend `tests/import-review-api.test.ts` or add a dedicated route test for the transaction-to-rule flow if more coverage is needed

Failure modes:

- If the UI only changes the label locally without refetching, the transaction list may show stale categories.
- If category selection is name-based instead of id-based, rule creation can target the wrong category.

### Step 2.2: Add a rules management section

Files:

- `frontend/src/features/categorization/components/CategorizationRulesSection.tsx`
- `frontend/src/features/categorization/hooks/useCategorizationRules.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`

Work:

- Add a dashboard section that lists active rules and supports disable.
- Show the fields the backend already returns:
  - priority
  - match type
  - pattern
  - category name
  - account name
  - active state

Validation:

- Manual:
  - create a rule
  - confirm it appears in the rules section
  - disable it
  - confirm it disappears or is marked inactive based on the chosen UX
- Automated:
  - reuse the existing route coverage in `tests/import-review-api.test.ts`

Failure modes:

- If disable is implemented only optimistically, a failed request will leave the list out of sync.

## Phase 3: Expose the full FX workflow

### Step 3.1: Extend currency controls into an FX management section

Files:

- `frontend/src/components/CurrencyControls.tsx` or a new `frontend/src/features/fx/components/FxManagementSection.tsx`
- `frontend/src/features/fx/hooks/useFxManagement.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`

Work:

- Keep the existing display mode controls.
- Add an advanced FX form with:
  - base currency
  - quote currency
  - rate
  - optional date
- Add an FX history list using `GET /api/expenses/fx`.
- Keep the existing backfill action available.

Validation:

- Manual:
  - submit a dated USD/PHP rate
  - confirm it appears in FX history
  - submit a non-USD/PHP pair if the backend contract should remain fully exposed
- Automated:
  - add an API test for `GET /api/expenses/fx` and dated `POST /api/expenses/fx-rate` if missing

Failure modes:

- If the advanced form silently keeps hardcoded currencies, the UI will appear broader than it actually is.
- If the history view does not refresh after submission, users cannot verify whether manual entries were stored.

## Phase 4: Make recurring recompute explicit

### Step 4.1: Remove recompute from general dashboard refresh

Files:

- `frontend/src/features/dashboard/hooks/useExpensesDashboard.ts`
- `frontend/src/features/dashboard/components/ExpensesDashboardPage.tsx`
- `frontend/src/features/dashboard/components/DashboardSection.tsx` or a new recurring feature component

Work:

- Split recurring loading into:
  - read recurring insights during normal refresh
  - trigger recompute only from an explicit user action
- Add a "Recompute recurring" control near the recurring card.
- After recompute succeeds, reload recurring insights and update the status line.

Validation:

- Manual:
  - load the dashboard and confirm it no longer mutates recurring data automatically
  - click recompute and confirm the recurring card refreshes
- Automated:
  - add a focused frontend test if the repo introduces component testing
  - otherwise cover the route at API level and keep manual verification explicit

Failure modes:

- Leaving recompute in the main refresh path will preserve a hidden mutation on every reload.
- Moving recompute without reloading insights will make the button appear broken.

## Phase 5: Integration hardening

### Step 5.1: Keep the new work behind focused feature boundaries

Target structure:

- `frontend/src/features/budgets/`
- `frontend/src/features/categorization/`
- `frontend/src/features/fx/`
- `frontend/src/features/recurring/`

Work:

- Do not push new mutation state back into `App.tsx` or `useExpensesDashboard()`.
- Keep the dashboard hook responsible for page-level loading and shared refresh only.
- Keep mutation-heavy logic in feature hooks close to the components that invoke it.

Validation:

- Review the dependency graph before merge:
  - budget code should not import categorization internals
  - FX code should not depend on import workflow components

Failure modes:

- If every new feature hooks directly into the dashboard reducer, maintainability regresses immediately.

### Step 5.2: Run full verification before merge

Required commands:

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

Manual regression checklist:

- Import a PDF statement
- Accept and reject an import review row
- Switch months
- Create a budget and target
- Create and disable a categorization rule
- Submit an FX rate and view it in history
- Trigger recurring recompute

## Recommended delivery order

1. Categories API support
2. Budget editor
3. Categorization workflow
4. FX history and advanced rate entry
5. Explicit recurring recompute

Reason:

- Budgets and categorization are blocked on category IDs.
- FX history is independent and can ship once typed.
- Recurring recompute should be deferred until after budget and categorization so the dashboard refresh path is changed once, not repeatedly.
