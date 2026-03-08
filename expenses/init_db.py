#!/usr/bin/env python3
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'money_dashboard.db'
SCHEMA = Path(__file__).resolve().parent / 'schema.sql'

with sqlite3.connect(DB_PATH) as conn:
    sql = SCHEMA.read_text(encoding='utf-8')
    conn.executescript(sql)
    conn.commit()

print(f'Initialized expenses schema in {DB_PATH}')
