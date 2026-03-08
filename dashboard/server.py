#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import subprocess
import os
import re
from urllib.parse import urlparse, parse_qs
import hashlib
import sqlite3
from datetime import datetime
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PORT = 8080
NODE_BIN = "/Users/brunoclaw/.nvm/versions/node/v24.13.1/bin/node"
PYTHON_BIN = "/usr/bin/python3"

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            return {}

    def _run_sql(self, sql):
        db = ROOT / "gym531.db"
        proc = subprocess.run(["sqlite3", str(db), sql], check=True, cwd=str(ROOT), capture_output=True, text=True)
        return (proc.stdout or "").strip()

    def _save_upload_bytes(self, filename, content_bytes, dest_dir):
        filename = os.path.basename(filename or "upload.bin")
        if not filename:
            filename = "upload.bin"
        dest_dir.mkdir(parents=True, exist_ok=True)
        out_path = dest_dir / filename
        with open(out_path, "wb") as f:
            f.write(content_bytes or b"")
        return out_path

    def _parse_multipart_form(self):
        ctype = self.headers.get('content-type', '') or ''
        m = re.search(r'boundary=(.+)', ctype)
        if 'multipart/form-data' not in ctype.lower() or not m:
            raise ValueError('multipart/form-data required')

        boundary = m.group(1).strip().strip('"')
        length = int(self.headers.get('content-length', '0') or 0)
        raw = self.rfile.read(length)
        boundary_bytes = ('--' + boundary).encode('utf-8')

        fields = {}
        files = {}

        for part in raw.split(boundary_bytes):
            part = part.strip()
            if not part or part == b'--':
                continue
            if part.startswith(b'--'):
                part = part[2:]
            if part.startswith(b'\r\n'):
                part = part[2:]

            header_blob, _, body = part.partition(b'\r\n\r\n')
            if not _:
                continue
            body = body.rstrip(b'\r\n')
            headers = header_blob.decode('utf-8', errors='ignore').split('\r\n')
            disp = ''
            for h in headers:
                if h.lower().startswith('content-disposition:'):
                    disp = h
                    break
            name_m = re.search(r'name="([^"]+)"', disp)
            if not name_m:
                continue
            name = name_m.group(1)
            file_m = re.search(r'filename="([^"]*)"', disp)
            if file_m and file_m.group(1):
                files[name] = {'filename': file_m.group(1), 'content': body}
            else:
                fields[name] = body.decode('utf-8', errors='ignore')

        return fields, files

    def _run_health_pipeline(self):
        user_id = os.environ.get("HEALTH_PIPELINE_USER_ID", "00000000-0000-0000-0000-000000000001")
        input_root = os.environ.get("HEALTH_PIPELINE_INPUT_ROOT", "imports/raw")
        output_root = os.environ.get("HEALTH_PIPELINE_OUTPUT_ROOT", "imports")
        config_path = os.environ.get("HEALTH_PIPELINE_CONFIG", "")

        cmd = [
            PYTHON_BIN,
            str(ROOT / "health_pipeline" / "run_pipeline.py"),
            "--user-id", user_id,
            "--input-root", input_root,
            "--output-root", output_root,
        ]
        if config_path:
            cmd.extend(["--config", config_path])

        proc = subprocess.run(cmd, check=True, cwd=str(ROOT), capture_output=True, text=True)

        # Guardrails: ensure required artifacts exist before dashboard refresh
        out_root = ROOT / output_root
        required = [
            out_root / "normalized" / "workouts.ndjson",
            out_root / "normalized" / "hr_samples.ndjson",
            out_root / "normalized" / "daily_recovery.ndjson",
            out_root / "normalized" / "sleep_sessions.ndjson",
            out_root / "normalized" / "daily_activity.ndjson",
            out_root / "normalized" / "workout_metrics.ndjson",
            out_root / "sql" / "upserts.sql",
        ]
        missing = [str(p) for p in required if not p.exists()]
        if missing:
            raise RuntimeError("health pipeline missing artifacts: " + ", ".join(missing))

        # Require anomaly report generation as completion condition
        logs_dir = out_root / "logs"
        if not logs_dir.exists() or not any(logs_dir.glob("ingestion-*.md")):
            raise RuntimeError("health pipeline missing anomaly log")

        return (proc.stdout or "").strip()

    def _ensure_cycle_tables(self):
        self._run_sql("""
CREATE TABLE IF NOT EXISTS deload_profiles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  main_set_scheme_json TEXT,
  assistance_mode TEXT NOT NULL DEFAULT 'reduced',
  cardio_mode TEXT NOT NULL DEFAULT 'light',
  rings_mode TEXT NOT NULL DEFAULT 'light',
  default_days INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cycle_events (
  id INTEGER PRIMARY KEY,
  event_date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('new_cycle','deload_applied','tm_test')),
  deload_code TEXT,
  block_no INTEGER,
  note TEXT,
  created_by TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deload_blocks (
  id INTEGER PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  deload_code TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS planned_barbell_sets_snapshot (
  id INTEGER PRIMARY KEY,
  session_date TEXT NOT NULL,
  block_no INTEGER,
  block_type TEXT,
  week_in_block INTEGER,
  day_name TEXT,
  category TEXT NOT NULL,
  lift TEXT NOT NULL,
  set_no INTEGER NOT NULL,
  prescribed_reps INTEGER,
  prescribed_pct REAL,
  planned_weight_kg REAL,
  source_tm_kg REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_date, category, lift, set_no)
);
INSERT OR IGNORE INTO deload_profiles(code,name,description,main_set_scheme_json,assistance_mode,cardio_mode,rings_mode,default_days) VALUES
('CLASSIC_40_50_60','Classic 5/3/1 Deload','Week 4 style deload', '[{"pct":0.40,"reps":5},{"pct":0.50,"reps":5},{"pct":0.60,"reps":5}]','reduced','light','light',7),
('WEEK7_LIGHT','7th Week Deload','Modern 7th week deload', '[{"pct":0.40,"reps":5},{"pct":0.50,"reps":5},{"pct":0.60,"reps":5}]','reduced','light','light',7),
('TM_TEST','Training Max Test Week','70/80/90/100 TM test', '[{"pct":0.70,"reps":5},{"pct":0.80,"reps":5},{"pct":0.90,"reps":3},{"pct":1.00,"reps":3}]','normal','normal','normal',7),
('FULL_BODY_TECH','Full-body Technique Deload','Low fatigue technique week', '[{"pct":0.40,"reps":5},{"pct":0.50,"reps":5},{"pct":0.60,"reps":5}]','reduced','light','light',7),
('MINIMAL_WARMUP','Minimal Deload (Warm-up only)','Warm-up sets only', '[]','off','optional','optional',3);
INSERT OR IGNORE INTO planned_barbell_sets_snapshot(
  session_date, block_no, block_type, week_in_block, day_name,
  category, lift, set_no, prescribed_reps, prescribed_pct, planned_weight_kg, source_tm_kg
)
SELECT
  p.session_date, p.block_no, p.block_type, p.week_in_block, p.day_name,
  p.category, p.lift, p.set_no, p.prescribed_reps, p.prescribed_pct, p.planned_weight_kg,
  ROUND(CASE WHEN p.prescribed_pct > 0 THEN p.planned_weight_kg / p.prescribed_pct ELSE NULL END, 2) AS source_tm_kg
FROM v_planned_barbell_sets p;
""")

    def _exp_connect(self):
        db = ROOT / "gym531.db"
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _exp_ensure_schema(self):
        schema = ROOT / "expenses" / "schema.sql"
        if not schema.exists():
            raise RuntimeError("expenses/schema.sql not found")
        with self._exp_connect() as conn:
            conn.executescript(schema.read_text(encoding="utf-8"))

            cols = {r[1] for r in conn.execute("PRAGMA table_info(exp_transactions)").fetchall()}
            if "amount_original" not in cols:
                conn.execute("ALTER TABLE exp_transactions ADD COLUMN amount_original REAL")
            if "amount_home" not in cols:
                conn.execute("ALTER TABLE exp_transactions ADD COLUMN amount_home REAL")
            if "fx_rate_used" not in cols:
                conn.execute("ALTER TABLE exp_transactions ADD COLUMN fx_rate_used REAL")
            if "fx_date" not in cols:
                conn.execute("ALTER TABLE exp_transactions ADD COLUMN fx_date TEXT")

            # backfill for existing rows
            conn.execute("UPDATE exp_transactions SET amount_original=COALESCE(amount_original, amount)")
            conn.execute("UPDATE exp_transactions SET amount_home=COALESCE(amount_home, amount)")
            conn.execute("UPDATE exp_transactions SET fx_rate_used=COALESCE(fx_rate_used, CASE WHEN currency='PHP' THEN 1.0 ELSE NULL END)")
            conn.execute("UPDATE exp_transactions SET fx_date=COALESCE(fx_date, tx_date)")

            conn.execute("INSERT OR IGNORE INTO exp_fx_rates(base_currency,quote_currency,rate_date,rate,provider) VALUES('PHP','PHP',date('now'),1.0,'system')")
            conn.execute("INSERT OR IGNORE INTO exp_fx_rates(base_currency,quote_currency,rate_date,rate,provider) VALUES('USD','PHP',date('now'),58.0,'bootstrap')")
            conn.commit()

    def _exp_infer_currency(self, account_name):
        n = (account_name or "").lower()
        if " usd" in n or "usd" in n:
            return "USD"
        return "PHP"

    def _exp_get_or_create_account(self, conn, account_name):
        name = (account_name or "Default Account").strip()
        row = conn.execute("SELECT id, currency FROM exp_accounts WHERE name=?", (name,)).fetchone()
        inferred = self._exp_infer_currency(name)
        if row:
            if (row[1] or "").upper() != inferred:
                conn.execute("UPDATE exp_accounts SET currency=? WHERE id=?", (inferred, int(row[0])))
            return int(row[0])
        cur = conn.execute("INSERT INTO exp_accounts(name,currency) VALUES(?,?)", (name, inferred))
        return int(cur.lastrowid)

    def _exp_fetch_fx_rate_online(self, base_currency, quote_currency, rate_date):
        b = (base_currency or 'USD').upper()
        q = (quote_currency or 'PHP').upper()
        d = (rate_date or '').strip()
        if b == q:
            return 1.0

        # Frankfurter historical endpoint
        url = f"https://api.frankfurter.app/{d}?from={b}&to={q}"
        with urllib.request.urlopen(url, timeout=12) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
        rates = payload.get('rates') or {}
        if q in rates:
            return float(rates[q])
        raise RuntimeError(f"FX rate unavailable for {b}/{q} on {d}")

    def _exp_get_fx_rate(self, conn, base_currency, quote_currency, tx_date):
        b = (base_currency or 'PHP').upper()
        q = (quote_currency or 'PHP').upper()
        d = (tx_date or '').strip()
        if b == q:
            return 1.0

        # exact date cache first
        row = conn.execute(
            "SELECT rate FROM exp_fx_rates WHERE base_currency=? AND quote_currency=? AND rate_date=? LIMIT 1",
            (b, q, d)
        ).fetchone()
        if row:
            return float(row[0])

        # try fetch online and cache
        try:
            rate = self._exp_fetch_fx_rate_online(b, q, d)
            conn.execute(
                "INSERT INTO exp_fx_rates(base_currency,quote_currency,rate_date,rate,provider) VALUES(?,?,?,?,?) ON CONFLICT(base_currency,quote_currency,rate_date) DO UPDATE SET rate=excluded.rate,provider=excluded.provider",
                (b, q, d, rate, 'frankfurter')
            )
            return float(rate)
        except Exception:
            pass

        # fallback latest <= date
        row2 = conn.execute(
            "SELECT rate FROM exp_fx_rates WHERE base_currency=? AND quote_currency=? AND rate_date<=? ORDER BY rate_date DESC LIMIT 1",
            (b, q, d)
        ).fetchone()
        if row2:
            return float(row2[0])

        # hard fallback
        if b == 'USD' and q == 'PHP':
            return 58.0
        return 1.0

    def _exp_extract_pdf_text(self, pdf_path):
        # Primary extractor: pdftotext (if installed)
        try:
            proc = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"], cwd=str(ROOT), capture_output=True, text=True)
            if proc.returncode == 0 and (proc.stdout or "").strip():
                return proc.stdout or ""
        except FileNotFoundError:
            pass
        except Exception:
            pass

        # Fallback extractor: pypdf
        try:
            from pypdf import PdfReader  # type: ignore
            reader = PdfReader(str(pdf_path))
            chunks = []
            for page in reader.pages:
                try:
                    chunks.append(page.extract_text() or "")
                except Exception:
                    continue
            text = "\n".join(chunks)
            if text.strip():
                return text
        except Exception as e:
            raise RuntimeError(f"failed to extract PDF text (pdftotext missing and pypdf failed: {e})")

        raise RuntimeError("failed to extract PDF text: no extractor produced output")

    def _exp_parse_tx_line(self, line):
        s = (line or "").strip()
        if not s:
            return None

        # Numeric-date format (generic)
        m = re.match(r"^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+([+-]?\$?\d[\d,]*\.\d{2})(?:\s+(CR|DR))?$", s, re.IGNORECASE)
        if m:
            raw_date, desc, amount_raw, crdr = m.groups()
            amount = float(amount_raw.replace(",", "").replace("$", ""))
            if crdr and crdr.upper() == "DR" and amount > 0:
                amount = -amount
            if crdr and crdr.upper() == "CR" and amount < 0:
                amount = abs(amount)

            tx_date = raw_date
            for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%m-%d-%Y", "%Y-%m-%d", "%d/%m/%y", "%m/%d/%y"):
                try:
                    tx_date = datetime.strptime(raw_date, fmt).strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass

            confidence = 0.9 if len(desc) > 3 else 0.7
            return {
                "tx_date": tx_date,
                "description": desc.strip(),
                "amount": amount,
                "confidence": confidence,
            }

        # Revolut-style format: 2 Jan 2026 Description $45.24 $124.94
        m2 = re.match(r"^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})(?:\s+\$([\d,]+\.\d{2}))?$", s)
        if not m2:
            return None

        raw_date, desc, tx_amt_raw, _bal = m2.groups()
        tx_date = datetime.strptime(raw_date, "%d %b %Y").strftime("%Y-%m-%d")
        amount = float(tx_amt_raw.replace(',', ''))

        # Heuristic sign detection (statement lacks explicit out/in marker after extraction)
        income_markers = [
            'transfer from', 'deposit', 'withdrawing savings', 'salary', 'refund', 'cashback', 'interest', 'received'
        ]
        dlow = (desc or '').lower()
        is_income = any(k in dlow for k in income_markers)
        if not is_income:
            amount = -amount

        return {
            "tx_date": tx_date,
            "description": desc.strip(),
            "amount": amount,
            "confidence": 0.82,
        }

    def _exp_parse_pdf_lines(self, lines):
        out = []
        cur_date = None
        cur_desc_parts = []

        date_prefix = re.compile(r"^(\w{3}\s+\d{1,2},\s+\d{4})\s+(.+)$")
        amount_re = re.compile(r"(-?\s*PHP\s*[\d,]+\.\d{2}|-?\$[\d,]+\.\d{2}|\$[\d,]+\.\d{2})", re.IGNORECASE)

        for raw in lines:
            s = (raw or "").strip()
            if not s:
                continue
            if s.lower().startswith("page ") or s.lower().startswith("available balance") or s.lower().startswith("account number") or s.lower().startswith("date counterparty"):
                continue

            # If legacy parser can parse the whole line, accept immediately
            parsed = self._exp_parse_tx_line(s)
            if parsed:
                out.append(parsed)
                cur_date = None
                cur_desc_parts = []
                continue

            dm = date_prefix.match(s)
            if dm:
                cur_date = dm.group(1)
                rest = dm.group(2).strip()
                cur_desc_parts = [rest] if rest else []
                continue

            # Accumulate continuation description lines
            if cur_date and not amount_re.search(s):
                cur_desc_parts.append(s)
                continue

            # Amount-only or desc+amount continuation line for current pending tx
            if cur_date and amount_re.search(s):
                am = amount_re.search(s)
                token = am.group(1)
                val = float(re.sub(r"[^0-9.-]", "", token.replace(",", "")))
                if token.strip().startswith("-"):
                    amount = -abs(val)
                else:
                    amount = abs(val)

                # infer amount sign if token positive but clearly outflow wording
                desc_full = " ".join(cur_desc_parts + [s[:am.start()].strip()]).strip()
                dlow = desc_full.lower()
                outflow_markers = ["pos w/d", "sent via", "w/d ", "withdraw", "interest withheld"]
                inflow_markers = ["received from", "interest pay", "cashback", "refund"]
                if "pmmf placement" in dlow or "investment" in dlow:
                    amount = abs(amount)
                elif amount > 0:
                    if any(k in dlow for k in outflow_markers):
                        amount = -amount
                    elif any(k in dlow for k in inflow_markers):
                        amount = amount
                    elif "transfer" in dlow and "from" not in dlow:
                        amount = -amount

                try:
                    tx_date = datetime.strptime(cur_date, "%b %d, %Y").strftime("%Y-%m-%d")
                except Exception:
                    tx_date = cur_date

                out.append({
                    "tx_date": tx_date,
                    "description": re.sub(r"\s+", " ", desc_full)[:200].strip() or "Transaction",
                    "amount": amount,
                    "confidence": 0.78,
                })
                cur_date = None
                cur_desc_parts = []
                continue

        return out

    def _exp_pick_category(self, conn, description, amount):
        desc = (description or "").lower()

        # 1) User-defined rules first
        rows = conn.execute("SELECT id, match_type, pattern FROM exp_categorization_rules WHERE active=1 ORDER BY priority ASC, id ASC").fetchall()
        for r in rows:
            mt = (r["match_type"] or "contains").lower()
            pattern = (r["pattern"] or "").lower()
            if not pattern:
                continue
            if mt == "contains" and pattern in desc:
                return int(r["category_id"])
            if mt == "exact" and pattern == desc:
                return int(r["category_id"])
            if mt == "regex":
                try:
                    if re.search(r["pattern"], description or "", re.IGNORECASE):
                        return int(r["category_id"])
                except Exception:
                    pass

        # 2) Built-in smart keyword classifier
        keyword_buckets = [
            ("Transfer", ["withdrawing savings", "depositing savings"]),
            ("Income", ["transfer from", "salary", "refund", "cashback", "interest", "received"]),
            ("Investment", ["pmmf placement", "investment", "money market", "mutual fund"]),
            ("Transfer", ["international transfer", "bank transfer", "transfer to", "to: alessandro metelli"]),
            ("Transport", ["grab", "uber", "taxi", "fuel", "petrol", "gas station"]),
            ("Groceries", ["supermarket", "sm superma", "shopsm", "sm supermarket", "sm store", "grocery", "market"]),
            ("Dining", ["cafe", "coffee", "starbucks", "restaurant", "food", "soft habit"]),
            ("Subscriptions", ["netflix", "spotify", "metal plan fee", "subscription", "claude.ai", "openai"]),
            ("Software/Cloud", ["vercel", "railway", "google cloud", "alchemy"]),
            ("Fitness", ["f45", "fitness", "gym"]),
            ("Travel", ["cebu pacific", "air", "hotel", "booking", "flight"]),
            ("Fees", ["fee", "atm", "cash withdrawal", "non-revolut fee"]),
        ]

        for cat_name, keys in keyword_buckets:
            if any(k in desc for k in keys):
                row = conn.execute("SELECT id FROM exp_categories WHERE name=?", (cat_name,)).fetchone()
                if row:
                    return int(row[0])

        # 3) Sensible fallback
        fallback = "Income" if (amount or 0) > 0 else "Uncategorized"
        row = conn.execute("SELECT id FROM exp_categories WHERE name=?", (fallback,)).fetchone()
        return int(row[0]) if row else None

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/expenses/overview":
            try:
                self._exp_ensure_schema()
                with self._exp_connect() as conn:
                    sums = conn.execute("SELECT COALESCE(SUM(CASE WHEN COALESCE(amount_home,amount)>0 AND COALESCE(c.kind,'expense')!='transfer' THEN COALESCE(amount_home,amount) END),0) income, COALESCE(SUM(CASE WHEN COALESCE(amount_home,amount)<0 AND COALESCE(c.kind,'expense')!='transfer' THEN COALESCE(amount_home,amount) END),0) expenses, COUNT(*) tx_count FROM exp_transactions t LEFT JOIN exp_categories c ON c.id=t.category_id").fetchone()
                    income = float(sums["income"] or 0)
                    expenses = float(sums["expenses"] or 0)
                    self._send_json(200, {"income": income, "expenses": expenses, "net": income + expenses, "txCount": int(sums["tx_count"] or 0)})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/expenses/fx":
            try:
                self._exp_ensure_schema()
                with self._exp_connect() as conn:
                    rows = conn.execute("SELECT base_currency, quote_currency, rate_date, rate FROM exp_fx_rates ORDER BY rate_date DESC, id DESC LIMIT 20").fetchall()
                    self._send_json(200, [dict(r) for r in rows])
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/expenses/transactions":
            try:
                self._exp_ensure_schema()
                q = parse_qs(parsed.query)
                try:
                    limit = max(1, min(200, int((q.get("limit") or ["50"])[0])))
                except Exception:
                    limit = 50
                with self._exp_connect() as conn:
                    rows = conn.execute(
                        "SELECT t.id, t.tx_date, t.description, t.amount, t.amount_original, t.amount_home, t.currency, t.fx_rate_used, a.name account_name, a.currency account_currency, c.name category_name, COALESCE(c.kind,'expense') category_kind "
                        "FROM exp_transactions t "
                        "LEFT JOIN exp_accounts a ON a.id=t.account_id "
                        "LEFT JOIN exp_categories c ON c.id=t.category_id "
                        "ORDER BY t.tx_date DESC, t.id DESC LIMIT ?", (limit,)
                    ).fetchall()
                    self._send_json(200, [dict(r) for r in rows])
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/expenses/fx-rate":
            try:
                self._exp_ensure_schema()
                body = self._read_json_body()
                base = (body.get('base') or 'USD').upper().strip()
                quote = (body.get('quote') or 'PHP').upper().strip()
                rate_date = (body.get('date') or self._run_sql("SELECT date('now','localtime');")).strip()
                rate = float(body.get('rate'))
                with self._exp_connect() as conn:
                    conn.execute(
                        "INSERT INTO exp_fx_rates(base_currency,quote_currency,rate_date,rate,provider) VALUES(?,?,?,?,?) ON CONFLICT(base_currency,quote_currency,rate_date) DO UPDATE SET rate=excluded.rate,provider=excluded.provider",
                        (base, quote, rate_date, rate, 'manual')
                    )
                    conn.execute(
                        "UPDATE exp_transactions SET amount_home = amount_original * ?, fx_rate_used=?, fx_date=? WHERE currency=?",
                        (rate, rate, rate_date, base)
                    )
                    conn.commit()
                self._send_json(200, {"ok": True})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/expenses/fx-backfill":
            try:
                self._exp_ensure_schema()
                with self._exp_connect() as conn:
                    rows = conn.execute("SELECT id, tx_date, currency, amount_original FROM exp_transactions WHERE currency='USD'").fetchall()
                    updated = 0
                    for r in rows:
                        rate = self._exp_get_fx_rate(conn, r['currency'], 'PHP', r['tx_date'])
                        amt_home = float(r['amount_original'] or 0) * float(rate)
                        conn.execute("UPDATE exp_transactions SET amount_home=?, fx_rate_used=?, fx_date=? WHERE id=?", (amt_home, rate, r['tx_date'], int(r['id'])))
                        updated += 1
                    conn.commit()
                self._send_json(200, {"ok": True, "updated": updated})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/expenses/import-pdf":
            try:
                self._exp_ensure_schema()
                fields, files = self._parse_multipart_form()
                file_item = files.get('file')
                account_name = (fields.get('accountName') or 'Default Account').strip()
                if not file_item or not file_item.get('filename'):
                    self._send_json(400, {"ok": False, "error": "file field is required"})
                    return
                if Path(file_item['filename']).suffix.lower() != '.pdf':
                    self._send_json(400, {"ok": False, "error": "only PDF supported"})
                    return

                dest = ROOT / 'imports' / 'raw' / 'bank' / 'latest'
                pdf_path = self._save_upload_bytes(file_item['filename'], file_item['content'], dest)
                text = self._exp_extract_pdf_text(pdf_path)
                lines = [ln for ln in (text or '').splitlines() if ln.strip()]
                parsed_entries = self._exp_parse_pdf_lines(lines)

                with self._exp_connect() as conn:
                    account_id = self._exp_get_or_create_account(conn, account_name)
                    acc = conn.execute("SELECT currency FROM exp_accounts WHERE id=?", (account_id,)).fetchone()
                    account_currency = (acc[0] if acc else 'PHP') or 'PHP'
                    cur = conn.execute(
                        "INSERT INTO exp_import_batches(source_type,source_filename,account_id,status,total_rows) VALUES('pdf',?,?,?,0)",
                        (pdf_path.name, account_id, 'parsed')
                    )
                    batch_id = int(cur.lastrowid)

                    parsed_count = 0
                    inserted_count = 0
                    row_no = 0
                    for parsed in parsed_entries:
                        row_no += 1
                        parsed_count += 1
                        raw_line = f"{parsed.get('tx_date','')} {parsed.get('description','')} {parsed.get('amount','')}"
                        conn.execute(
                            "INSERT INTO exp_import_rows_raw(batch_id,row_no,raw_text,parsed_tx_date,parsed_description,parsed_amount,confidence,status) VALUES(?,?,?,?,?,?,?,?)",
                            (batch_id, row_no, raw_line, parsed['tx_date'], parsed['description'], parsed['amount'], parsed['confidence'], 'parsed')
                        )

                        cat_id = self._exp_pick_category(conn, parsed['description'], parsed['amount'])
                        normalized_line = re.sub(r"\s+", " ", raw_line.strip().lower())
                        src = f"{parsed['tx_date']}|{parsed['description'].strip().lower()}|{parsed['amount']:.2f}|{normalized_line}"
                        source_hash = hashlib.sha256(src.encode('utf-8')).hexdigest()

                        # Guard 1: strong hash-based dedupe (account-independent)
                        exists_hash = conn.execute("SELECT 1 FROM exp_transactions WHERE source_hash=? LIMIT 1", (source_hash,)).fetchone()
                        if exists_hash:
                            continue

                        # Guard 2: fallback business-key dedupe for same statement re-imports
                        exists_bk = conn.execute(
                            "SELECT 1 FROM exp_transactions WHERE tx_date=? AND lower(trim(description))=lower(trim(?)) AND amount=? LIMIT 1",
                            (parsed['tx_date'], parsed['description'], parsed['amount'])
                        ).fetchone()
                        if exists_bk:
                            continue

                        try:
                            amount_original = float(parsed['amount'])
                            fx_rate = self._exp_get_fx_rate(conn, account_currency, 'PHP', parsed['tx_date'])
                            amount_home = amount_original * fx_rate
                            conn.execute(
                                "INSERT INTO exp_transactions(account_id,tx_date,description,amount,currency,amount_original,amount_home,fx_rate_used,fx_date,category_id,import_batch_id,source_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                (account_id, parsed['tx_date'], parsed['description'], amount_original, account_currency, amount_original, amount_home, fx_rate, parsed['tx_date'], cat_id, batch_id, source_hash)
                            )
                            inserted_count += 1
                        except sqlite3.IntegrityError:
                            pass

                    conn.execute("UPDATE exp_import_batches SET total_rows=?, inserted_rows=?, status=? WHERE id=?", (parsed_count, inserted_count, 'done', batch_id))
                    conn.commit()

                self._send_json(200, {"ok": True, "batchId": batch_id, "parsedRows": parsed_count, "insertedTransactions": inserted_count})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/upload-health":
            try:
                fields, files = self._parse_multipart_form()
                kind = (fields.get('kind') or 'apple').strip().lower()
                file_item = files.get('file')
                if not file_item or not file_item.get('filename'):
                    self._send_json(400, {"ok": False, "error": "file field is required"})
                    return

                if kind == 'apple':
                    dest = ROOT / 'imports' / 'raw' / 'apple' / 'latest'
                    allowed = {'.xml', '.zip'}
                elif kind == 'polar':
                    dest = ROOT / 'imports' / 'raw' / 'polar' / 'latest'
                    allowed = {'.tcx', '.csv', '.fit'}
                else:
                    self._send_json(400, {"ok": False, "error": "kind must be apple or polar"})
                    return

                ext = Path(file_item['filename']).suffix.lower()
                if ext not in allowed:
                    self._send_json(400, {"ok": False, "error": f"unsupported file type {ext} for {kind}"})
                    return

                out_path = self._save_upload_bytes(file_item['filename'], file_item['content'], dest)
                self._send_json(200, {"ok": True, "path": str(out_path.relative_to(ROOT)), "kind": kind})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/cycle/start":
            self._ensure_cycle_tables()
            body = self._read_json_body()
            start_date = (body.get("startDate") or "").strip()
            block_type = (body.get("blockType") or "").strip() or None
            note = (body.get("note") or "Started from dashboard").replace("'", "''")

            if not start_date:
                start_date = self._run_sql("SELECT date('now','localtime','+1 day');")

            if block_type not in {"Leader", "Anchor", None}:
                self._send_json(400, {"ok": False, "error": "blockType must be Leader or Anchor"})
                return

            try:
                last = self._run_sql("SELECT COALESCE(MAX(block_no),0), COALESCE(MAX(template_id),1), COALESCE((SELECT block_type FROM program_blocks ORDER BY block_no DESC LIMIT 1),'Leader') FROM program_blocks;")
                parts = (last or "0|1|Leader").split("|")
                next_block = int(parts[0] or 0) + 1
                template_id = int(parts[1] or 1)
                chosen_type = block_type or (parts[2] if len(parts) > 2 and parts[2] in {"Leader","Anchor"} else "Leader")

                sql = (
                    "BEGIN;"
                    f"INSERT INTO program_blocks(block_no,block_type,start_date,template_id,notes) VALUES({next_block},'{chosen_type}','{start_date}',{template_id},'{note}');"
                    f"INSERT INTO cycle_events(event_date,event_type,block_no,note,created_by) VALUES(date('now','localtime'),'new_cycle',{next_block},'Start new cycle: {chosen_type} @ {start_date}','dashboard');"
                    "INSERT OR IGNORE INTO planned_barbell_sets_snapshot("
                    "session_date, block_no, block_type, week_in_block, day_name, category, lift, set_no, prescribed_reps, prescribed_pct, planned_weight_kg, source_tm_kg"
                    ") "
                    f"SELECT p.session_date, p.block_no, p.block_type, p.week_in_block, p.day_name, p.category, p.lift, p.set_no, p.prescribed_reps, p.prescribed_pct, p.planned_weight_kg, ROUND(CASE WHEN p.prescribed_pct > 0 THEN p.planned_weight_kg / p.prescribed_pct ELSE NULL END, 2) FROM v_planned_barbell_sets p WHERE p.block_no={next_block};"
                    "COMMIT;"
                )
                self._run_sql(sql)
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "blockNo": next_block, "blockType": chosen_type, "startDate": start_date})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/cycle/deload":
            self._ensure_cycle_tables()
            body = self._read_json_body()
            deload_code = (body.get("deloadCode") or "").strip().upper()
            start_date = (body.get("startDate") or "").strip() or self._run_sql("SELECT date('now','localtime');")
            duration_days = int(body.get("durationDays") or 7)
            note = (body.get("note") or "Deload applied from dashboard").replace("'", "''")

            if not deload_code:
                self._send_json(400, {"ok": False, "error": "deloadCode required"})
                return

            try:
                exists = self._run_sql(f"SELECT COUNT(*) FROM deload_profiles WHERE code='{deload_code}';")
                if int(exists or "0") <= 0:
                    self._send_json(400, {"ok": False, "error": "unknown deloadCode"})
                    return

                end_date = self._run_sql(f"SELECT date('{start_date}', '+{max(0,duration_days-1)} day');")
                block_no = int(self._run_sql("SELECT COALESCE(MAX(block_no),0) FROM program_blocks;") or "0")

                sql = (
                    "BEGIN;"
                    f"INSERT INTO deload_blocks(start_date,end_date,deload_code,note) VALUES('{start_date}','{end_date}','{deload_code}','{note}');"
                    f"INSERT INTO cycle_events(event_date,event_type,deload_code,block_no,note,created_by) VALUES(date('now','localtime'),'deload_applied','{deload_code}',{block_no},'Deload {deload_code}: {start_date}..{end_date}','dashboard');"
                    "COMMIT;"
                )
                self._run_sql(sql)
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "deloadCode": deload_code, "startDate": start_date, "endDate": end_date})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/tm/update":
            body = self._read_json_body()
            lift = (body.get("lift") or "").strip()
            mode = (body.get("mode") or "delta").strip()
            value_raw = body.get("value")
            effective_date = (body.get("effectiveDate") or "").strip() or self._run_sql("SELECT date('now','localtime');")
            note = (body.get("note") or "TM update from dashboard").replace("'", "''")

            if not lift:
                self._send_json(400, {"ok": False, "error": "lift required"})
                return
            if mode not in {"delta", "set"}:
                self._send_json(400, {"ok": False, "error": "mode must be delta or set"})
                return
            try:
                value = float(value_raw)
            except Exception:
                self._send_json(400, {"ok": False, "error": "numeric value required"})
                return

            try:
                safe_lift = lift.replace("'", "''")
                row = self._run_sql(
                    "SELECT l.id, COALESCE((SELECT tm_kg FROM training_max_history t WHERE t.lift_id=l.id ORDER BY effective_date DESC, id DESC LIMIT 1), 0) "
                    f"FROM lifts l WHERE l.name='{safe_lift}';"
                )
                if not row:
                    self._send_json(400, {"ok": False, "error": "unknown lift"})
                    return
                parts = row.split("|")
                lift_id = int(parts[0])
                current_tm = float(parts[1]) if len(parts) > 1 else 0.0
                new_tm = value if mode == "set" else (current_tm + value)
                if new_tm <= 0:
                    self._send_json(400, {"ok": False, "error": "resulting TM must be > 0"})
                    return

                sql = (
                    "BEGIN;"
                    f"INSERT INTO training_max_history(lift_id,effective_date,tm_kg,cycle_label) VALUES({lift_id},'{effective_date}',{new_tm},'{note}') "
                    "ON CONFLICT(lift_id,effective_date) DO UPDATE SET tm_kg=excluded.tm_kg, cycle_label=excluded.cycle_label;"
                    "COMMIT;"
                )
                self._run_sql(sql)
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "lift": lift, "tmKg": new_tm, "effectiveDate": effective_date})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return

        if parsed.path == "/api/refresh":
            q = parse_qs(parsed.query)
            include_health = (q.get("includeHealth") or ["0"])[0] in {"1", "true", "yes"}
            try:
                health_status = None
                if include_health:
                    health_status = self._run_health_pipeline()

                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "healthPipeline": health_status})
            except Exception as e:
                self._send_json(500, {
                    "ok": False,
                    "error": (str(e)).strip()
                })
            return

        if parsed.path == "/api/refresh-health":
            try:
                health_status = self._run_health_pipeline()
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "healthPipeline": health_status})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e).strip()})
            return

        if parsed.path == "/api/set-status":
            q = parse_qs(parsed.query)
            date = (q.get("date") or [None])[0]
            status = (q.get("status") or [None])[0]

            if not date or not status or status not in {"green", "yellow", "red"}:
                self._send_json(400, {"ok": False, "error": "date and valid status required"})
                return

            sql = (
                "INSERT INTO recovery_status(session_date,pain_level,note) "
                f"VALUES('{date}','{status}','Set from dashboard') "
                "ON CONFLICT(session_date) DO UPDATE SET pain_level=excluded.pain_level;"
            )

            try:
                self._run_sql(sql)
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True})
            except subprocess.CalledProcessError as e:
                self._send_json(500, {"ok": False, "error": (e.stderr or e.stdout or str(e)).strip()})
            return

        if parsed.path == "/api/log-aerobic-test":
            body = self._read_json_body()
            test_type = (body.get("testType") or "").strip().upper()
            date = (body.get("date") or "").strip()
            if test_type not in {"FIXED_SPEED", "FIXED_HR", "ZONE2_SESSION"}:
                self._send_json(400, {"ok": False, "error": "invalid testType"})
                return
            if not date:
                self._send_json(400, {"ok": False, "error": "date required"})
                return

            def num(v):
                try:
                    if v is None or v == "":
                        return None
                    return float(v)
                except Exception:
                    return None

            speed = num(body.get("speed"))
            distance = num(body.get("distance"))
            duration = num(body.get("duration"))
            avg_hr = num(body.get("avgHr"))
            max_hr = num(body.get("maxHr"))
            avg_speed = num(body.get("avgSpeed"))
            hr1 = num(body.get("hrFirstHalf"))
            hr2 = num(body.get("hrSecondHalf"))
            sp1 = num(body.get("speedFirstHalf"))
            sp2 = num(body.get("speedSecondHalf"))
            notes = (body.get("notes") or "").replace("'", "''")

            decoupling = None
            if test_type == "ZONE2_SESSION" and hr1 and hr1 > 0 and hr2 is not None:
                decoupling = round(((hr2 - hr1) / hr1) * 100.0, 2)

            def sqlv(v):
                return "NULL" if v is None else str(int(v) if isinstance(v, float) and v.is_integer() else v)

            sql = (
                "INSERT INTO aerobic_tests(date,test_type,speed,distance,duration,avg_hr,max_hr,avg_speed,hr_first_half,hr_second_half,speed_first_half,speed_second_half,decoupling_percent,notes) VALUES "
                f"('{date}','{test_type}',{sqlv(speed)},{sqlv(distance)},{sqlv(duration)},{sqlv(avg_hr)},{sqlv(max_hr)},{sqlv(avg_speed)},{sqlv(hr1)},{sqlv(hr2)},{sqlv(sp1)},{sqlv(sp2)},{sqlv(decoupling)},'{notes}');"
            )
            try:
                self._run_sql(sql)
                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True, "decouplingPercent": decoupling})
            except subprocess.CalledProcessError as e:
                self._send_json(500, {"ok": False, "error": (e.stderr or e.stdout or str(e)).strip()})
            return

        if parsed.path == "/api/log-action":
            body = self._read_json_body()
            action = body.get("action")
            date = body.get("date")

            if not action or not date:
                self._send_json(400, {"ok": False, "error": "action and date required"})
                return

            try:
                if action == "main_done":
                    rows = body.get("plannedBarbellRows") or []
                    main_rows = [r for r in rows if r.get("category") == "main"]
                    if not main_rows:
                        self._send_json(400, {"ok": False, "error": "no planned main rows"})
                        return

                    sql = ["BEGIN;"]
                    sql.append(
                        f"INSERT INTO barbell_sessions(session_date,weekday,week_in_block,day_id,notes) "
                        f"VALUES('{date}', ((CAST(strftime('%w','{date}') AS INTEGER)+6)%7)+1, 1, NULL, 'Logged from dashboard main_done') "
                        f"ON CONFLICT(session_date) DO NOTHING;"
                    )
                    sql.append(
                        f"DELETE FROM barbell_set_logs WHERE session_id=(SELECT id FROM barbell_sessions WHERE session_date='{date}') AND category='main';"
                    )
                    for r in main_rows:
                        lift = str(r.get("lift", "")).replace("'", "''")
                        set_no = int(r.get("set_no") or 0)
                        reps = int(r.get("prescribed_reps") or 0)
                        wt = float(r.get("planned_weight_kg") or 0)
                        pct = float(r.get("prescribed_pct") or 0)
                        sql.append(
                            "INSERT INTO barbell_set_logs(session_id,lift_id,category,set_no,prescribed_pct,prescribed_reps,actual_weight_kg,actual_reps,note) "
                            f"SELECT bs.id,l.id,'main',{set_no},{pct},{reps},{wt},{reps},'Main done from dashboard' "
                            f"FROM barbell_sessions bs JOIN lifts l ON l.name='{lift}' WHERE bs.session_date='{date}';"
                        )
                    sql.append("COMMIT;")
                    self._run_sql("\n".join(sql))

                elif action == "supp_done":
                    rows = body.get("plannedBarbellRows") or []
                    supp_rows = [r for r in rows if r.get("category") == "supplemental"]
                    if not supp_rows:
                        self._send_json(400, {"ok": False, "error": "no planned supplemental rows"})
                        return

                    sql = ["BEGIN;"]
                    sql.append(
                        f"INSERT INTO barbell_sessions(session_date,weekday,week_in_block,day_id,notes) "
                        f"VALUES('{date}', ((CAST(strftime('%w','{date}') AS INTEGER)+6)%7)+1, 1, NULL, 'Logged from dashboard supp_done') "
                        f"ON CONFLICT(session_date) DO NOTHING;"
                    )
                    sql.append(
                        f"DELETE FROM barbell_set_logs WHERE session_id=(SELECT id FROM barbell_sessions WHERE session_date='{date}') AND category='supplemental';"
                    )
                    for r in supp_rows:
                        lift = str(r.get("lift", "")).replace("'", "''")
                        set_no = int(r.get("set_no") or 0)
                        reps = int(r.get("prescribed_reps") or 0)
                        wt = float(r.get("planned_weight_kg") or 0)
                        pct = float(r.get("prescribed_pct") or 0)
                        sql.append(
                            "INSERT INTO barbell_set_logs(session_id,lift_id,category,set_no,prescribed_pct,prescribed_reps,actual_weight_kg,actual_reps,note) "
                            f"SELECT bs.id,l.id,'supplemental',{set_no},{pct},{reps},{wt},{reps},'Supplemental done from dashboard' "
                            f"FROM barbell_sessions bs JOIN lifts l ON l.name='{lift}' WHERE bs.session_date='{date}';"
                        )
                    sql.append("COMMIT;")
                    self._run_sql("\n".join(sql))

                elif action == "supp_modified":
                    text = (body.get("suppModifiedText") or "").strip()
                    rows = body.get("plannedBarbellRows") or []
                    supp_rows = [r for r in rows if r.get("category") == "supplemental"]
                    if not supp_rows:
                        self._send_json(400, {"ok": False, "error": "no planned supplemental rows"})
                        return
                    m = re.search(r"(\d+)\s*x\s*(\d+)\s*@\s*(\d+(?:\.\d+)?)", text.replace("X", "x"))
                    if not m:
                        self._send_json(400, {"ok": False, "error": "format must be like 5x10@60"})
                        return
                    sets = int(m.group(1)); reps = int(m.group(2)); wt = float(m.group(3))
                    lift = str(supp_rows[0].get("lift", "")).replace("'", "''")

                    sql = ["BEGIN;"]
                    sql.append(
                        f"INSERT INTO barbell_sessions(session_date,weekday,week_in_block,day_id,notes) "
                        f"VALUES('{date}', ((CAST(strftime('%w','{date}') AS INTEGER)+6)%7)+1, 1, NULL, 'Logged from dashboard supp_modified') "
                        f"ON CONFLICT(session_date) DO NOTHING;"
                    )
                    sql.append(
                        f"DELETE FROM barbell_set_logs WHERE session_id=(SELECT id FROM barbell_sessions WHERE session_date='{date}') AND category='supplemental';"
                    )
                    for i in range(1, sets + 1):
                        sql.append(
                            "INSERT INTO barbell_set_logs(session_id,lift_id,category,set_no,prescribed_reps,actual_weight_kg,actual_reps,note) "
                            f"SELECT bs.id,l.id,'supplemental',{i},{reps},{wt},{reps},'Supplemental modified from dashboard' "
                            f"FROM barbell_sessions bs JOIN lifts l ON l.name='{lift}' WHERE bs.session_date='{date}';"
                        )
                    sql.append("COMMIT;")
                    self._run_sql("\n".join(sql))

                elif action == "cardio_done":
                    p = body.get("plannedCardio") or {}
                    session_type = p.get("session_type") or "Z2"
                    if session_type == "Z2_VO2_4x4":
                        protocol = "VO2_4x4"
                    elif session_type == "Z2_VO2_1min":
                        protocol = "VO2_1min"
                    elif session_type in {"Z2", "VO2_4x4", "VO2_1min"}:
                        protocol = session_type
                    else:
                        protocol = "Z2"
                    duration = int(p.get("duration_min") or 30)

                    avg_hr_raw = body.get("avgHr")
                    try:
                        avg_hr = int(avg_hr_raw) if avg_hr_raw is not None else int(p.get("target_hr_min") or 0)
                    except Exception:
                        avg_hr = 0
                    if avg_hr <= 0:
                        avg_hr = 120

                    speed_raw = body.get("speedKmh")
                    try:
                        speed_input = float(speed_raw) if speed_raw is not None else None
                    except Exception:
                        speed_input = None
                    try:
                        speed_low = float(p.get("speed_low_kmh")) if p.get("speed_low_kmh") is not None else None
                    except Exception:
                        speed_low = None
                    try:
                        speed_high = float(p.get("speed_high_kmh")) if p.get("speed_high_kmh") is not None else None
                    except Exception:
                        speed_high = None
                    speed_for_trend = speed_input if speed_input is not None else (speed_high if speed_high is not None else speed_low)

                    note = "Cardio done from dashboard (avg HR logged)"
                    if speed_for_trend is not None:
                        note += f" @ {speed_for_trend:.1f} km/h"
                    note_sql = note.replace("'", "''")

                    z2_cap = 1 if protocol == "Z2" else "NULL"
                    sql = (
                        "INSERT INTO cardio_sessions(session_date,slot,protocol,duration_min,avg_hr,z2_cap_respected,notes) "
                        f"VALUES('{date}','CARDIO','{protocol}',{duration},{avg_hr},{z2_cap},'{note_sql}') "
                        "ON CONFLICT(session_date,slot) DO UPDATE SET "
                        "protocol=excluded.protocol,duration_min=excluded.duration_min,avg_hr=excluded.avg_hr,z2_cap_respected=excluded.z2_cap_respected,notes=excluded.notes;"
                    )
                    self._run_sql(sql)

                    if protocol in {"VO2_4x4", "VO2_1min"} and speed_for_trend is not None:
                        work_raw = body.get("workMin")
                        rest_raw = body.get("restMin")
                        try:
                            work_min = float(work_raw) if work_raw is not None else (4.0 if protocol == "VO2_4x4" else 1.0)
                        except Exception:
                            work_min = 4.0 if protocol == "VO2_4x4" else 1.0
                        try:
                            easy_min = float(rest_raw) if rest_raw is not None else (3.0 if protocol == "VO2_4x4" else 1.0)
                        except Exception:
                            easy_min = 3.0 if protocol == "VO2_4x4" else 1.0

                        sid_sql = f"SELECT id FROM cardio_sessions WHERE session_date='{date}' AND slot='CARDIO' LIMIT 1;"
                        sid = self._run_sql(sid_sql).strip()
                        if sid:
                            self._run_sql(f"DELETE FROM cardio_intervals WHERE session_id={sid};")
                            self._run_sql(
                                "INSERT INTO cardio_intervals(session_id,interval_no,work_min,easy_min,target_speed_kmh,achieved_hr,note) "
                                f"VALUES({sid},1,{work_min},{easy_min},{speed_for_trend},{avg_hr},'Auto summary interval from dashboard cardio_done');"
                            )

                elif action == "z2_fixed_hr_test":
                    avg_hr_raw = body.get("avgHr")
                    speed_raw = body.get("speedKmh")
                    try:
                        avg_hr = int(avg_hr_raw)
                    except Exception:
                        avg_hr = 0
                    try:
                        speed_kmh = float(speed_raw)
                    except Exception:
                        speed_kmh = 0.0

                    if avg_hr <= 0 or speed_kmh <= 0:
                        self._send_json(400, {"ok": False, "error": "avgHr and speedKmh are required"})
                        return

                    z2_cap = 1 if avg_hr <= 125 else 0
                    note = f"Z2 fixed HR test 120 bpm @ {speed_kmh:.1f} km/h, avg HR {avg_hr}"
                    note_sql = note.replace("'", "''")
                    sql = (
                        "INSERT INTO cardio_sessions(session_date,slot,protocol,duration_min,avg_hr,z2_cap_respected,notes) "
                        f"VALUES('{date}','CARDIO','Z2',30,{avg_hr},{z2_cap},'{note_sql}') "
                        "ON CONFLICT(session_date,slot) DO UPDATE SET "
                        "protocol=excluded.protocol,duration_min=excluded.duration_min,avg_hr=excluded.avg_hr,z2_cap_respected=excluded.z2_cap_respected,notes=excluded.notes;"
                    )
                    self._run_sql(sql)

                elif action == "rings_done":
                    sql = (
                        "INSERT INTO rings_sessions(session_date,slot,template,completed_as_prescribed,notes) "
                        "SELECT '" + date + "','PM',"
                        "COALESCE((SELECT template_code FROM rings_plan_days WHERE weekday=((CAST(strftime('%w','" + date + "') AS INTEGER)+6)%7)+1),'A'),"
                        "1,'Rings done from dashboard' "
                        "ON CONFLICT(session_date,slot) DO UPDATE SET template=excluded.template,completed_as_prescribed=excluded.completed_as_prescribed,notes=excluded.notes;"
                    )
                    self._run_sql(sql)
                    self._run_sql(
                        "DELETE FROM rings_logs WHERE session_id=(SELECT id FROM rings_sessions WHERE session_date='" + date + "' AND slot='PM');"
                    )
                    self._run_sql(
                        "INSERT INTO rings_logs(session_id,item_no,exercise,result_text,completed) "
                        "SELECT rs.id,rti.item_no,rti.exercise,'completed as prescribed',1 "
                        "FROM rings_sessions rs "
                        "JOIN rings_templates rt ON rt.code=rs.template "
                        "JOIN rings_template_items rti ON rti.template_id=rt.id "
                        "WHERE rs.session_date='" + date + "' AND rs.slot='PM' "
                        "ORDER BY rti.item_no;"
                    )
                else:
                    self._send_json(400, {"ok": False, "error": "unknown action"})
                    return

                subprocess.run([
                    NODE_BIN, str(ROOT / "dashboard" / "export-data.mjs")
                ], check=True, cwd=str(ROOT), capture_output=True, text=True)
                self._send_json(200, {"ok": True})
            except subprocess.CalledProcessError as e:
                self._send_json(500, {"ok": False, "error": (e.stderr or e.stdout or str(e)).strip()})
            return

        self._send_json(404, {"ok": False, "error": "Not found"})

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving dashboard with refresh API on http://127.0.0.1:{PORT}")
    server.serve_forever()
