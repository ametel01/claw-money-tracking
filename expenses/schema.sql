PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS exp_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL DEFAULT 'PHP',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'expense' CHECK(kind IN ('expense','income','transfer')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_merchants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES exp_accounts(id) ON DELETE RESTRICT,
  tx_date TEXT NOT NULL,
  posted_date TEXT,
  description TEXT NOT NULL,
  merchant_id INTEGER REFERENCES exp_merchants(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES exp_categories(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  amount_original REAL,
  amount_home REAL,
  fx_rate_used REAL,
  fx_date TEXT,
  import_batch_id INTEGER,
  source_hash TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_hash)
);

CREATE TABLE IF NOT EXISTS exp_fx_rates (
  id INTEGER PRIMARY KEY,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  rate REAL NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(base_currency, quote_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_exp_transactions_date ON exp_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_exp_transactions_account_date ON exp_transactions(account_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_exp_transactions_category_date ON exp_transactions(category_id, tx_date);

CREATE TABLE IF NOT EXISTS exp_import_batches (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'pdf',
  source_filename TEXT,
  account_id INTEGER REFERENCES exp_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'parsed' CHECK(status IN ('queued','parsed','reviewed','done','error')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  parse_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_import_rows_raw (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES exp_import_batches(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  parsed_tx_date TEXT,
  parsed_description TEXT,
  parsed_amount REAL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'parsed' CHECK(status IN ('parsed','accepted','rejected','duplicate','needs_review')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_categorization_rules (
  id INTEGER PRIMARY KEY,
  priority INTEGER NOT NULL DEFAULT 100,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains','regex','exact')),
  pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES exp_categories(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES exp_accounts(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exp_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO exp_categories(name, kind) VALUES
  ('Uncategorized','expense'),
  ('Food','expense'),
  ('Dining','expense'),
  ('Groceries','expense'),
  ('Transport','expense'),
  ('Bills','expense'),
  ('Shopping','expense'),
  ('Health','expense'),
  ('Subscriptions','expense'),
  ('Software/Cloud','expense'),
  ('Fitness','expense'),
  ('Travel','expense'),
  ('Fees','expense'),
  ('Income','income'),
  ('Salary','income'),
  ('Transfer','transfer'),
  ('Investment','transfer');
