# Money Dashboard

Standalone money tracking dashboard repository.

## Run

```bash
bun install
bun run build
python3 expenses/init_db.py
./scripts/start_money_dashboard.sh
# or: PORT=8081 python3 dashboard/server.py
# or: PORT=9090 ./scripts/start_money_dashboard.sh
```

Open:

- http://127.0.0.1:8081/expenses/

## Included

- `frontend/` TypeScript source
- `public/expenses/` compiled dashboard assets
- `expenses/` schema + bootstrap scripts
- `dashboard/server.py` lean static/API server
- `dashboard/expenses_service.py` expenses domain logic
- `money_dashboard.db` SQLite database
- `scripts/start_money_dashboard.sh`

## Tooling

```bash
bun run dev
bun run test:python
bun run typecheck
bun run lint
bun run format
bun run build
```
