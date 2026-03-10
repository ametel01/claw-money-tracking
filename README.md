# Money Dashboard

Standalone money tracking dashboard repository, now fully backed by Node.js and TypeScript.

## Run

```bash
bun install
bun run db:init
PORT=9081 bun run dev
```

For a production-style run:

```bash
bun run build
bun run start
```

Open:

- http://127.0.0.1:5173/ during `bun run dev`
- http://127.0.0.1:8081/ during `bun run start`

## Included

- `frontend/` React + Vite dashboard source
- `server/` Express + TypeScript API, SQLite service, PDF parsing/import logic
- `expenses/` SQLite schema
- `tests/` TypeScript fixture tests for parsing/import behavior
- `money_dashboard.db` SQLite database
- `scripts/` lightweight Node/TypeScript helpers

## Tooling

```bash
bun run dev
bun run db:init
bun run build
bun run start
bun run test
bun run typecheck
bun run lint
bun run format
bun run verify
```
