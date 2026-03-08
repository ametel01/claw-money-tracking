from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import urllib.request
from typing import Any


@dataclass(frozen=True, slots=True)
class ParsedExpenseTransaction:
    tx_date: str
    description: str
    amount: float
    confidence: float


class ExpensesService:
    def __init__(self, root: Path):
        self.root = root
        self.db_path = root / 'money_dashboard.db'
        self.schema_path = root / 'expenses' / 'schema.sql'

    def get_overview(self) -> dict[str, Any]:
        self.ensure_schema()

        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT
                  COALESCE(SUM(
                    CASE
                      WHEN COALESCE(t.amount_home, t.amount) > 0
                        AND COALESCE(c.kind, 'expense') != 'transfer'
                      THEN COALESCE(t.amount_home, t.amount)
                    END
                  ), 0) AS income,
                  COALESCE(SUM(
                    CASE
                      WHEN COALESCE(t.amount_home, t.amount) < 0
                        AND COALESCE(c.kind, 'expense') != 'transfer'
                      THEN COALESCE(t.amount_home, t.amount)
                    END
                  ), 0) AS expenses,
                  COUNT(*) AS tx_count
                FROM exp_transactions AS t
                LEFT JOIN exp_categories AS c ON c.id = t.category_id
                """
            ).fetchone()

        income = float(row['income'] or 0)
        expenses = float(row['expenses'] or 0)

        return {
            'income': income,
            'expenses': expenses,
            'net': income + expenses,
            'txCount': int(row['tx_count'] or 0),
        }

    def list_transactions(self, limit: int) -> list[dict[str, Any]]:
        self.ensure_schema()

        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT
                  t.id,
                  t.tx_date,
                  t.description,
                  t.amount,
                  t.amount_original,
                  t.amount_home,
                  t.currency,
                  t.fx_rate_used,
                  a.name AS account_name,
                  a.currency AS account_currency,
                  c.name AS category_name,
                  COALESCE(c.kind, 'expense') AS category_kind
                FROM exp_transactions AS t
                LEFT JOIN exp_accounts AS a ON a.id = t.account_id
                LEFT JOIN exp_categories AS c ON c.id = t.category_id
                ORDER BY t.tx_date DESC, t.id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [dict(row) for row in rows]

    def list_fx_rates(self, limit: int = 20) -> list[dict[str, Any]]:
        self.ensure_schema()

        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT base_currency, quote_currency, rate_date, rate, provider
                FROM exp_fx_rates
                ORDER BY rate_date DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [dict(row) for row in rows]

    def upsert_fx_rate(
        self,
        base_currency: str,
        quote_currency: str,
        rate: float,
        rate_date: str | None,
    ) -> dict[str, Any]:
        self.ensure_schema()

        base = (base_currency or 'USD').upper().strip()
        quote = (quote_currency or 'PHP').upper().strip()
        resolved_rate_date = (rate_date or datetime.now().date().isoformat()).strip()
        if rate <= 0:
            raise ValueError('rate must be greater than zero')

        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO exp_fx_rates(base_currency, quote_currency, rate_date, rate, provider)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(base_currency, quote_currency, rate_date)
                DO UPDATE SET rate = excluded.rate, provider = excluded.provider
                """,
                (base, quote, resolved_rate_date, rate, 'manual'),
            )
            connection.execute(
                """
                UPDATE exp_transactions
                SET amount_home = amount_original * ?, fx_rate_used = ?, fx_date = ?
                WHERE currency = ?
                """,
                (rate, rate, resolved_rate_date, base),
            )
            connection.commit()

        return {'ok': True}

    def backfill_fx(self) -> dict[str, Any]:
        self.ensure_schema()

        updated = 0
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT id, tx_date, currency, amount_original
                FROM exp_transactions
                WHERE currency = 'USD'
                """
            ).fetchall()

            for row in rows:
                rate = self._get_fx_rate(connection, row['currency'], 'PHP', row['tx_date'])
                amount_home = float(row['amount_original'] or 0) * float(rate)
                connection.execute(
                    """
                    UPDATE exp_transactions
                    SET amount_home = ?, fx_rate_used = ?, fx_date = ?
                    WHERE id = ?
                    """,
                    (amount_home, rate, row['tx_date'], int(row['id'])),
                )
                updated += 1

            connection.commit()

        return {'ok': True, 'updated': updated}

    def import_pdf_statement(
        self,
        account_name: str,
        filename: str,
        content: bytes,
    ) -> dict[str, Any]:
        self.ensure_schema()

        destination = self.root / 'imports' / 'raw' / 'bank' / 'latest'
        pdf_path = self._save_upload_bytes(filename, content, destination)
        text = self._extract_pdf_text(pdf_path)
        lines = [line for line in text.splitlines() if line.strip()]
        parsed_entries = self._parse_pdf_lines(lines)

        with self.connect() as connection:
            account_id = self._get_or_create_account(connection, account_name)
            account_row = connection.execute(
                'SELECT currency FROM exp_accounts WHERE id = ?',
                (account_id,),
            ).fetchone()
            account_currency = (account_row['currency'] if account_row else 'PHP') or 'PHP'

            batch_cursor = connection.execute(
                """
                INSERT INTO exp_import_batches(source_type, source_filename, account_id, status, total_rows)
                VALUES('pdf', ?, ?, ?, 0)
                """,
                (pdf_path.name, account_id, 'parsed'),
            )
            batch_id = int(batch_cursor.lastrowid)

            parsed_count = 0
            inserted_count = 0

            for row_number, parsed_entry in enumerate(parsed_entries, start=1):
                parsed_count += 1
                raw_line = (
                    f'{parsed_entry.tx_date} {parsed_entry.description} {parsed_entry.amount}'
                ).strip()
                connection.execute(
                    """
                    INSERT INTO exp_import_rows_raw(
                      batch_id,
                      row_no,
                      raw_text,
                      parsed_tx_date,
                      parsed_description,
                      parsed_amount,
                      confidence,
                      status
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        batch_id,
                        row_number,
                        raw_line,
                        parsed_entry.tx_date,
                        parsed_entry.description,
                        parsed_entry.amount,
                        parsed_entry.confidence,
                        'parsed',
                    ),
                )

                if self._transaction_exists(connection, parsed_entry, raw_line):
                    continue

                category_id = self._pick_category(
                    connection,
                    parsed_entry.description,
                    parsed_entry.amount,
                )
                fx_rate = self._get_fx_rate(
                    connection,
                    account_currency,
                    'PHP',
                    parsed_entry.tx_date,
                )
                amount_original = float(parsed_entry.amount)
                amount_home = amount_original * fx_rate

                try:
                    connection.execute(
                        """
                        INSERT INTO exp_transactions(
                          account_id,
                          tx_date,
                          description,
                          amount,
                          currency,
                          amount_original,
                          amount_home,
                          fx_rate_used,
                          fx_date,
                          category_id,
                          import_batch_id,
                          source_hash
                        )
                        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            account_id,
                            parsed_entry.tx_date,
                            parsed_entry.description,
                            amount_original,
                            account_currency,
                            amount_original,
                            amount_home,
                            fx_rate,
                            parsed_entry.tx_date,
                            category_id,
                            batch_id,
                            self._build_source_hash(parsed_entry, raw_line),
                        ),
                    )
                    inserted_count += 1
                except sqlite3.IntegrityError:
                    continue

            connection.execute(
                """
                UPDATE exp_import_batches
                SET total_rows = ?, inserted_rows = ?, status = ?
                WHERE id = ?
                """,
                (parsed_count, inserted_count, 'done', batch_id),
            )
            connection.commit()

        return {
            'ok': True,
            'batchId': batch_id,
            'parsedRows': parsed_count,
            'insertedTransactions': inserted_count,
        }

    def ensure_schema(self) -> None:
        if not self.schema_path.exists():
            raise RuntimeError('expenses/schema.sql not found')

        with self.connect() as connection:
            connection.executescript(self.schema_path.read_text(encoding='utf-8'))
            existing_columns = {
                row['name']
                for row in connection.execute('PRAGMA table_info(exp_transactions)').fetchall()
            }

            if 'amount_original' not in existing_columns:
                connection.execute('ALTER TABLE exp_transactions ADD COLUMN amount_original REAL')
            if 'amount_home' not in existing_columns:
                connection.execute('ALTER TABLE exp_transactions ADD COLUMN amount_home REAL')
            if 'fx_rate_used' not in existing_columns:
                connection.execute('ALTER TABLE exp_transactions ADD COLUMN fx_rate_used REAL')
            if 'fx_date' not in existing_columns:
                connection.execute('ALTER TABLE exp_transactions ADD COLUMN fx_date TEXT')

            connection.execute(
                'UPDATE exp_transactions SET amount_original = COALESCE(amount_original, amount)'
            )
            connection.execute(
                'UPDATE exp_transactions SET amount_home = COALESCE(amount_home, amount)'
            )
            connection.execute(
                """
                UPDATE exp_transactions
                SET fx_rate_used = COALESCE(
                  fx_rate_used,
                  CASE WHEN currency = 'PHP' THEN 1.0 ELSE NULL END
                )
                """
            )
            connection.execute(
                'UPDATE exp_transactions SET fx_date = COALESCE(fx_date, tx_date)'
            )

            connection.execute(
                """
                INSERT OR IGNORE INTO exp_fx_rates(
                  base_currency,
                  quote_currency,
                  rate_date,
                  rate,
                  provider
                )
                VALUES('PHP', 'PHP', date('now'), 1.0, 'system')
                """
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO exp_fx_rates(
                  base_currency,
                  quote_currency,
                  rate_date,
                  rate,
                  provider
                )
                VALUES('USD', 'PHP', date('now'), 58.0, 'bootstrap')
                """
            )
            connection.commit()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path))
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys = ON')
        return connection

    def _save_upload_bytes(self, filename: str, content: bytes, destination: Path) -> Path:
        safe_name = os.path.basename(filename or 'statement.pdf') or 'statement.pdf'
        destination.mkdir(parents=True, exist_ok=True)
        output_path = destination / safe_name
        output_path.write_bytes(content)
        return output_path

    def _extract_pdf_text(self, pdf_path: Path) -> str:
        try:
            process = subprocess.run(
                ['pdftotext', '-layout', str(pdf_path), '-'],
                check=False,
                capture_output=True,
                text=True,
            )
            if process.returncode == 0 and process.stdout.strip():
                return process.stdout
        except FileNotFoundError:
            pass

        try:
            from pypdf import PdfReader  # type: ignore

            reader = PdfReader(str(pdf_path))
            extracted_pages: list[str] = []

            for page in reader.pages:
                extracted_pages.append(page.extract_text() or '')

            text = '\n'.join(extracted_pages).strip()
            if text:
                return text
        except Exception as error:
            raise RuntimeError(
                'failed to extract PDF text (pdftotext missing and pypdf failed: '
                f'{error})'
            ) from error

        raise RuntimeError('failed to extract PDF text: no extractor produced output')

    def _parse_pdf_lines(self, lines: list[str]) -> list[ParsedExpenseTransaction]:
        parsed_rows: list[ParsedExpenseTransaction] = []
        current_date: str | None = None
        current_description: list[str] = []
        date_prefix = re.compile(r'^(\w{3}\s+\d{1,2},\s+\d{4})\s+(.+)$')
        amount_pattern = re.compile(
            r'(-?\s*PHP\s*[\d,]+\.\d{2}|-?\$[\d,]+\.\d{2}|\$[\d,]+\.\d{2})',
            re.IGNORECASE,
        )

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.lower().startswith(
                ('page ', 'available balance', 'account number', 'date counterparty')
            ):
                continue

            parsed_line = self._parse_transaction_line(line)
            if parsed_line:
                parsed_rows.append(parsed_line)
                current_date = None
                current_description = []
                continue

            date_match = date_prefix.match(line)
            if date_match:
                current_date = date_match.group(1)
                current_description = [date_match.group(2).strip()]
                continue

            if current_date and not amount_pattern.search(line):
                current_description.append(line)
                continue

            amount_match = amount_pattern.search(line)
            if current_date and amount_match:
                token = amount_match.group(1)
                value = float(re.sub(r'[^0-9.-]', '', token.replace(',', '')))
                amount = -abs(value) if token.strip().startswith('-') else abs(value)
                description = ' '.join(current_description + [line[: amount_match.start()].strip()])
                normalized_description = re.sub(r'\s+', ' ', description).strip()
                description_lower = normalized_description.lower()

                if 'pmmf placement' in description_lower or 'investment' in description_lower:
                    amount = abs(amount)
                elif amount > 0 and self._looks_like_outflow(description_lower):
                    amount = -amount

                try:
                    tx_date = datetime.strptime(current_date, '%b %d, %Y').strftime('%Y-%m-%d')
                except ValueError:
                    tx_date = current_date

                parsed_rows.append(
                    ParsedExpenseTransaction(
                        tx_date=tx_date,
                        description=normalized_description[:200] or 'Transaction',
                        amount=amount,
                        confidence=0.78,
                    )
                )
                current_date = None
                current_description = []

        return parsed_rows

    def _parse_transaction_line(self, line: str) -> ParsedExpenseTransaction | None:
        numeric_date_match = re.match(
            r'^(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.+?)\s+([+-]?\$?\d[\d,]*\.\d{2})(?:\s+(CR|DR))?$',
            line,
            re.IGNORECASE,
        )
        if numeric_date_match:
            raw_date, description, amount_raw, crdr = numeric_date_match.groups()
            amount = float(amount_raw.replace(',', '').replace('$', ''))

            if crdr and crdr.upper() == 'DR' and amount > 0:
                amount = -amount
            if crdr and crdr.upper() == 'CR' and amount < 0:
                amount = abs(amount)

            return ParsedExpenseTransaction(
                tx_date=self._normalize_transaction_date(raw_date),
                description=description.strip(),
                amount=amount,
                confidence=0.9 if len(description) > 3 else 0.7,
            )

        revolut_match = re.match(
            r'^(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.+?)\s+\$([\d,]+\.\d{2})(?:\s+\$([\d,]+\.\d{2}))?$',
            line,
        )
        if not revolut_match:
            return None

        raw_date, description, amount_raw, _balance = revolut_match.groups()
        amount = float(amount_raw.replace(',', ''))
        description_lower = description.lower()

        if not self._looks_like_income(description_lower):
            amount = -amount

        return ParsedExpenseTransaction(
            tx_date=datetime.strptime(raw_date, '%d %b %Y').strftime('%Y-%m-%d'),
            description=description.strip(),
            amount=amount,
            confidence=0.82,
        )

    def _normalize_transaction_date(self, raw_date: str) -> str:
        formats = (
            '%d/%m/%Y',
            '%d-%m-%Y',
            '%m/%d/%Y',
            '%m-%d-%Y',
            '%Y-%m-%d',
            '%d/%m/%y',
            '%m/%d/%y',
        )

        for fmt in formats:
            try:
                return datetime.strptime(raw_date, fmt).strftime('%Y-%m-%d')
            except ValueError:
                continue

        return raw_date

    def _pick_category(
        self,
        connection: sqlite3.Connection,
        description: str,
        amount: float,
    ) -> int | None:
        normalized_description = (description or '').lower()
        rows = connection.execute(
            """
            SELECT category_id, match_type, pattern
            FROM exp_categorization_rules
            WHERE active = 1
            ORDER BY priority ASC, id ASC
            """
        ).fetchall()

        for row in rows:
            match_type = (row['match_type'] or 'contains').lower()
            pattern = row['pattern'] or ''

            if not pattern:
                continue

            normalized_pattern = pattern.lower()
            if match_type == 'contains' and normalized_pattern in normalized_description:
                return int(row['category_id'])
            if match_type == 'exact' and normalized_pattern == normalized_description:
                return int(row['category_id'])
            if match_type == 'regex':
                try:
                    if re.search(pattern, description or '', re.IGNORECASE):
                        return int(row['category_id'])
                except re.error:
                    continue

        keyword_buckets = [
            ('Transfer', ['withdrawing savings', 'depositing savings']),
            ('Income', ['transfer from', 'salary', 'refund', 'cashback', 'interest', 'received']),
            ('Investment', ['pmmf placement', 'investment', 'money market', 'mutual fund']),
            (
                'Transfer',
                ['international transfer', 'bank transfer', 'transfer to', 'to: alessandro metelli'],
            ),
            ('Transport', ['grab', 'uber', 'taxi', 'fuel', 'petrol', 'gas station']),
            ('Groceries', ['supermarket', 'shopsm', 'sm supermarket', 'sm store', 'grocery', 'market']),
            ('Dining', ['cafe', 'coffee', 'starbucks', 'restaurant', 'food', 'soft habit']),
            ('Subscriptions', ['netflix', 'spotify', 'metal plan fee', 'subscription', 'claude.ai', 'openai']),
            ('Software/Cloud', ['vercel', 'railway', 'google cloud', 'alchemy']),
            ('Fitness', ['f45', 'fitness', 'gym']),
            ('Travel', ['cebu pacific', 'air', 'hotel', 'booking', 'flight']),
            ('Fees', ['fee', 'atm', 'cash withdrawal', 'non-revolut fee']),
        ]

        for category_name, keywords in keyword_buckets:
            if any(keyword in normalized_description for keyword in keywords):
                category_row = connection.execute(
                    'SELECT id FROM exp_categories WHERE name = ?',
                    (category_name,),
                ).fetchone()
                if category_row:
                    return int(category_row['id'])

        fallback_name = 'Income' if amount > 0 else 'Uncategorized'
        fallback_row = connection.execute(
            'SELECT id FROM exp_categories WHERE name = ?',
            (fallback_name,),
        ).fetchone()

        return int(fallback_row['id']) if fallback_row else None

    def _transaction_exists(
        self,
        connection: sqlite3.Connection,
        parsed_entry: ParsedExpenseTransaction,
        raw_line: str,
    ) -> bool:
        source_hash = self._build_source_hash(parsed_entry, raw_line)

        by_hash = connection.execute(
            'SELECT 1 FROM exp_transactions WHERE source_hash = ? LIMIT 1',
            (source_hash,),
        ).fetchone()
        if by_hash:
            return True

        by_business_key = connection.execute(
            """
            SELECT 1
            FROM exp_transactions
            WHERE tx_date = ?
              AND lower(trim(description)) = lower(trim(?))
              AND amount = ?
            LIMIT 1
            """,
            (parsed_entry.tx_date, parsed_entry.description, parsed_entry.amount),
        ).fetchone()

        return by_business_key is not None

    def _build_source_hash(
        self, parsed_entry: ParsedExpenseTransaction, raw_line: str
    ) -> str:
        normalized_line = re.sub(r'\s+', ' ', raw_line.strip().lower())
        source = (
            f'{parsed_entry.tx_date}|'
            f'{parsed_entry.description.strip().lower()}|'
            f'{parsed_entry.amount:.2f}|'
            f'{normalized_line}'
        )
        return hashlib.sha256(source.encode('utf-8')).hexdigest()

    def _get_or_create_account(
        self, connection: sqlite3.Connection, account_name: str
    ) -> int:
        name = (account_name or 'Default Account').strip()
        inferred_currency = self._infer_currency(name)
        row = connection.execute(
            'SELECT id, currency FROM exp_accounts WHERE name = ?',
            (name,),
        ).fetchone()

        if row:
            if (row['currency'] or '').upper() != inferred_currency:
                connection.execute(
                    'UPDATE exp_accounts SET currency = ? WHERE id = ?',
                    (inferred_currency, int(row['id'])),
                )
            return int(row['id'])

        cursor = connection.execute(
            'INSERT INTO exp_accounts(name, currency) VALUES(?, ?)',
            (name, inferred_currency),
        )
        return int(cursor.lastrowid)

    def _infer_currency(self, account_name: str) -> str:
        normalized = (account_name or '').lower()
        if 'usd' in normalized:
            return 'USD'
        return 'PHP'

    def _get_fx_rate(
        self,
        connection: sqlite3.Connection,
        base_currency: str,
        quote_currency: str,
        rate_date: str,
    ) -> float:
        base = (base_currency or 'PHP').upper()
        quote = (quote_currency or 'PHP').upper()
        resolved_date = (rate_date or '').strip()

        if base == quote:
            return 1.0

        direct_rate = connection.execute(
            """
            SELECT rate
            FROM exp_fx_rates
            WHERE base_currency = ? AND quote_currency = ? AND rate_date = ?
            LIMIT 1
            """,
            (base, quote, resolved_date),
        ).fetchone()
        if direct_rate:
            return float(direct_rate['rate'])

        try:
            fetched_rate = self._fetch_fx_rate_online(base, quote, resolved_date)
            connection.execute(
                """
                INSERT INTO exp_fx_rates(base_currency, quote_currency, rate_date, rate, provider)
                VALUES(?, ?, ?, ?, ?)
                ON CONFLICT(base_currency, quote_currency, rate_date)
                DO UPDATE SET rate = excluded.rate, provider = excluded.provider
                """,
                (base, quote, resolved_date, fetched_rate, 'frankfurter'),
            )
            return float(fetched_rate)
        except Exception:
            pass

        fallback_rate = connection.execute(
            """
            SELECT rate
            FROM exp_fx_rates
            WHERE base_currency = ? AND quote_currency = ? AND rate_date <= ?
            ORDER BY rate_date DESC
            LIMIT 1
            """,
            (base, quote, resolved_date),
        ).fetchone()
        if fallback_rate:
            return float(fallback_rate['rate'])

        if base == 'USD' and quote == 'PHP':
            return 58.0
        return 1.0

    def _fetch_fx_rate_online(
        self, base_currency: str, quote_currency: str, rate_date: str
    ) -> float:
        if base_currency == quote_currency:
            return 1.0

        url = (
            f'https://api.frankfurter.app/{rate_date}?from={base_currency}&to={quote_currency}'
        )
        with urllib.request.urlopen(url, timeout=12) as response:
            payload = json.loads(response.read().decode('utf-8'))

        rates = payload.get('rates') or {}
        if quote_currency not in rates:
            raise RuntimeError(
                f'FX rate unavailable for {base_currency}/{quote_currency} on {rate_date}'
            )

        return float(rates[quote_currency])

    def _looks_like_income(self, description: str) -> bool:
        income_markers = (
            'transfer from',
            'deposit',
            'withdrawing savings',
            'salary',
            'refund',
            'cashback',
            'interest',
            'received',
        )
        return any(marker in description for marker in income_markers)

    def _looks_like_outflow(self, description: str) -> bool:
        outflow_markers = ('pos w/d', 'sent via', 'w/d ', 'withdraw', 'interest withheld')
        inflow_markers = ('received from', 'interest pay', 'cashback', 'refund')

        if any(marker in description for marker in inflow_markers):
            return False
        if 'transfer' in description and 'from' not in description:
            return True

        return any(marker in description for marker in outflow_markers)
