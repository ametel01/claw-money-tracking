# Expenses Backend

This directory now owns the SQLite schema and bootstrap scripts for the expenses
domain. The dashboard frontend source lives in `frontend/`
and builds into `public/expenses/`.

## Setup

From the repository root:

```bash
bun install
bun run build
python3 expenses/init_db.py
python3 dashboard/server.py
```

Open `http://127.0.0.1:8081/expenses/`.

## API

- `GET /api/expenses/overview`
- `GET /api/expenses/transactions?limit=400`
- `GET /api/expenses/fx`
- `POST /api/expenses/fx-rate`
- `POST /api/expenses/fx-backfill`
- `POST /api/expenses/import-pdf`

## Notes

- PDF extraction uses `pdftotext -layout` first, then falls back to `pypdf`.
- Duplicate protection uses a SHA-256 `source_hash` plus a business-key check.
