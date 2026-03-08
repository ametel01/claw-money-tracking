# Claw Money Tracking

Expense-tracking dashboard with PDF import, SQLite storage, smart categorization, transfer-neutral accounting, and multi-currency normalization (USD/PHP).

## Included

- `expenses/` mobile-first UI and schema
- `dashboard/server.py` API server (includes expenses endpoints)

## Quick start

```bash
python3 expenses/init_db.py
python3 dashboard/server.py
# open http://127.0.0.1:8080/expenses/
```

## Key APIs

- `POST /api/expenses/import-pdf`
- `GET /api/expenses/overview`
- `GET /api/expenses/transactions`
- `POST /api/expenses/fx-rate`
- `POST /api/expenses/fx-backfill`
