# Expenses Backend

This directory owns the SQLite schema for the expenses domain. The dashboard frontend
lives in `frontend/`, and the Node/TypeScript backend lives in `server/`.

## Setup

From the repository root:

```bash
bun install
bun run db:init
PORT=8081 bun run dev
```

Open `http://127.0.0.1:5173/expenses/` in development, or run `bun run build && bun run start`
for the built server on `http://127.0.0.1:8081/expenses/`.

## API

- `GET /api/expenses/overview`
- `GET /api/expenses/transactions?limit=400`
- `GET /api/expenses/fx`
- `POST /api/expenses/fx-rate`
- `POST /api/expenses/fx-backfill`
- `POST /api/expenses/import-pdf`

## Notes

- PDF extraction uses `pdftotext -layout` first, then falls back to `pdf-parse`.
- Duplicate protection uses a SHA-256 `source_hash` plus a business-key check.
