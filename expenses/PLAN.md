# Expenses Dashboard v1 Plan

## 1) SQLite Schema (implemented)
- `exp_accounts`, `exp_categories`, `exp_merchants`
- `exp_transactions`
- `exp_import_batches`, `exp_import_rows_raw`
- `exp_categorization_rules`

`schema.sql` is idempotent and runs against `gym531.db`.

## 2) PDF Import Pipeline (implemented in server API)
1. Upload statement PDF to `/api/expenses/import-pdf`.
2. Save file under `imports/raw/bank/latest/`.
3. Extract text with `pdftotext -layout`.
4. Parse candidate transaction rows with date + amount regexes.
5. Insert raw parsed rows into `exp_import_rows_raw` with confidence score.
6. Auto-commit high-confidence rows into `exp_transactions`.
7. Deduplicate by `source_hash` unique key.

## 3) v1 Web App (mobile-first)
- Public path: `/expenses/`
- Light/teal theme (different from gym dashboard dark theme)
- Cards: income, expenses, net, transactions count
- Statement upload form
- Recent transaction list

## Next increments
- Manual review page for low-confidence rows
- Rule editor (`exp_categorization_rules`) UI
- Monthly/category chart endpoint and widgets
- CSV export and budget tracking
