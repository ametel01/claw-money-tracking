# Expenses Dashboard

Mobile-friendly expenses tracker at `/expenses/` using SQLite (`gym531.db`).

## Setup

From workspace root:

```bash
python3 expenses/init_db.py
```

## Run server

```bash
python3 dashboard/server.py
```

Then open:

- `http://127.0.0.1:8080/expenses/`
- or your existing tailnet route: `/expenses/`

## API

- `GET /api/expenses/overview`
- `GET /api/expenses/transactions?limit=40`
- `POST /api/expenses/import-pdf` (multipart: `accountName`, `file`)

## Notes

- PDF parsing currently uses `pdftotext -layout` + regex-based extraction.
- Duplicate transaction detection uses SHA256 `source_hash` unique constraint.
