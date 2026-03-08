# Gym531 Local Dashboard

Dark-themed static dashboard for the `gym531.db` data.

## Files

- `index.html` – UI shell
- `styles.css` – dark card/tile styling
- `app.js` – renders cards, weekly progress, and daily tiles from JSON
- `export-data.mjs` – lightweight data exporter (`gym531.db` -> `dashboard/data.json`)

## Generate data

From workspace root:

```bash
node dashboard/export-data.mjs
```

This writes/refreshes:

- `dashboard/data.json`

## Run locally

From workspace root:

```bash
python3 -m http.server 8080
```

Then open:

- http://localhost:8080/dashboard/

## Notes

- Uses existing schema/tables/views from `gym531.db`.
- Weekly rows are anchored to the latest logged training date.
- Daily tiles show the latest 14-day window ending on latest logged date.

## Refresh APIs

- `POST /api/refresh` → existing dashboard export refresh.
- `POST /api/refresh?includeHealth=1` → run health dual-source pipeline first, then refresh dashboard export.
- `POST /api/refresh-health` → same as above (explicit endpoint).

Environment variables for health pipeline:

- `HEALTH_PIPELINE_USER_ID` (default: `00000000-0000-0000-0000-000000000001`)
- `HEALTH_PIPELINE_INPUT_ROOT` (default: `imports/raw`)
- `HEALTH_PIPELINE_OUTPUT_ROOT` (default: `imports`)
- `HEALTH_PIPELINE_CONFIG` (optional path)
