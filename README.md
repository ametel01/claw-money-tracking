# Money Dashboard

Standalone money tracking dashboard repository.

## Run

```bash
python3 expenses/init_db.py
python3 dashboard/server.py
```

Open:

- http://127.0.0.1:8080/expenses/

## Included

- `expenses/` UI + schema/init
- `dashboard/server.py` (serves expenses endpoints)
- `money_dashboard.db` SQLite database
- `scripts/start_money_dashboard.sh`
