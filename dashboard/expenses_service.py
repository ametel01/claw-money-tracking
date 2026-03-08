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
            self._run_expense_data_migrations(connection)
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
        if self._looks_like_bpi_account_activities(lines):
            return self._parse_bpi_account_activities(lines)

        if self._looks_like_revolut_statement(lines):
            return self._parse_revolut_statement(lines)

        return self._parse_generic_pdf_lines(lines)

    def _parse_generic_pdf_lines(self, lines: list[str]) -> list[ParsedExpenseTransaction]:
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

    def _looks_like_bpi_account_activities(self, lines: list[str]) -> bool:
        return any('Account number:' in line for line in lines) and any(
            'Counterparty' in line for line in lines
        )

    def _parse_bpi_account_activities(self, lines: list[str]) -> list[ParsedExpenseTransaction]:
        row_start = re.compile(
            r'^([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+(.+?)\s+(-?PHP[\d,]+\.\d{2})$'
        )
        parsed_rows: list[ParsedExpenseTransaction] = []
        current_row: dict[str, str | float | list[str]] | None = None

        def flush_current_row() -> None:
            nonlocal current_row
            if not current_row:
                return

            raw_description = self._collapse_description_parts(
                current_row['description_parts']  # type: ignore[arg-type]
            )
            raw_counterparty = self._collapse_description_parts(
                current_row['counterparty_parts']  # type: ignore[arg-type]
            )
            description = self._normalize_local_bank_description(
                raw_description,
                counterparty=raw_counterparty,
            )
            parsed_rows.append(
                ParsedExpenseTransaction(
                    tx_date=current_row['tx_date'],  # type: ignore[arg-type]
                    description=description or 'Transaction',
                    amount=current_row['amount'],  # type: ignore[arg-type]
                    confidence=0.96,
                )
            )
            current_row = None

        for raw_line in lines:
            line = raw_line.replace('\f', '').rstrip()
            stripped = line.strip()
            if not stripped or self._is_bpi_noise_line(stripped):
                continue

            match = row_start.match(stripped)
            if match:
                flush_current_row()
                raw_date, payload, amount_token = match.groups()
                counterparty_part, description_part = self._extract_bpi_row_segments(payload)
                counterparty_parts = [counterparty_part] if counterparty_part else []
                description_parts = [description_part] if description_part else []

                current_row = {
                    'tx_date': datetime.strptime(raw_date, '%b %d, %Y').strftime('%Y-%m-%d'),
                    'counterparty_parts': counterparty_parts,
                    'description_parts': description_parts,
                    'amount': self._parse_php_amount(amount_token),
                }
                continue

            if current_row:
                counterparty_part, description_part = self._extract_bpi_row_segments(stripped)
                if counterparty_part:
                    current_row['counterparty_parts'].append(counterparty_part)  # type: ignore[index]
                if description_part:
                    current_row['description_parts'].append(description_part)  # type: ignore[index]

        flush_current_row()
        return parsed_rows

    def _looks_like_revolut_statement(self, lines: list[str]) -> bool:
        return any('Account transactions from' in line for line in lines) and any(
            'Revolut Ltd' in line for line in lines
        )

    def _parse_revolut_statement(self, lines: list[str]) -> list[ParsedExpenseTransaction]:
        parsed_rows: list[ParsedExpenseTransaction] = []
        current_header: str | None = None
        in_transaction_section = False

        def flush_current_row() -> None:
            nonlocal current_header
            if not current_header:
                return

            parsed_row = self._parse_revolut_transaction_header(current_header)
            if parsed_row:
                parsed_rows.append(parsed_row)
            current_header = None

        for raw_line in lines:
            line = raw_line.replace('\f', '').rstrip()
            stripped = line.strip()
            if not stripped:
                continue

            if 'Account transactions from' in stripped:
                in_transaction_section = True
                continue
            if not in_transaction_section:
                continue
            if self._is_revolut_noise_line(stripped):
                continue

            if re.match(r'^[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\s+', stripped):
                flush_current_row()
                current_header = stripped
                continue

        flush_current_row()
        return parsed_rows

    def _parse_revolut_transaction_header(
        self, line: str
    ) -> ParsedExpenseTransaction | None:
        columns = re.split(r'\s{2,}', line.strip())
        if len(columns) < 4:
            return None

        raw_date = columns[0]
        description = columns[1]
        money_columns = [
            column for column in columns[2:] if re.fullmatch(r'\$[\d,]+\.\d{2}', column)
        ]
        if len(money_columns) < 2:
            return None

        amount = self._parse_usd_amount(money_columns[-2])
        normalized_description = description.lower()
        if 'depositing savings' in normalized_description:
            amount = -abs(amount)
        elif self._looks_like_income(normalized_description):
            amount = abs(amount)
        else:
            amount = -abs(amount)

        return ParsedExpenseTransaction(
            tx_date=datetime.strptime(raw_date, '%b %d, %Y').strftime('%Y-%m-%d'),
            description=description.strip(),
            amount=amount,
            confidence=0.96,
        )

    def _is_bpi_noise_line(self, line: str) -> bool:
        return (
            line.startswith('Dear customer,')
            or line.startswith('The transactions are listed below')
            or line.startswith('Account number')
            or line.startswith('Available balance')
            or line.startswith('Date')
            or line.startswith('Counterparty')
            or line.startswith('Description')
            or line.startswith('Amount')
            or line.startswith('Exported date range')
            or line.startswith('Page ')
        )

    def _is_revolut_noise_line(self, line: str) -> bool:
        return (
            line.startswith('USD Statement')
            or line.startswith('Generated on ')
            or line.startswith('Revolut Ltd')
            or line.startswith('Date')
            or line.startswith('Report lost or stolen card')
            or line.startswith('+44 ')
            or line.startswith('Get help directly in-app')
            or line.startswith('Scan the QR code')
            or line.startswith('© ')
            or line.startswith('Page ')
        )

    def _extract_bpi_description_segment(self, text: str) -> str:
        segments = [segment.strip() for segment in re.split(r'\s{2,}', text) if segment.strip()]
        if not segments:
            return ''
        return re.sub(r'\s+', ' ', segments[-1]).strip()

    def _extract_bpi_row_segments(self, text: str) -> tuple[str, str]:
        segments = [segment.strip() for segment in re.split(r'\s{2,}', text) if segment.strip()]
        if not segments:
            return ('', '')
        if len(segments) == 1:
            return ('', re.sub(r'\s+', ' ', segments[0]).strip())
        return (
            re.sub(r'\s+', ' ', segments[0]).strip(),
            re.sub(r'\s+', ' ', segments[-1]).strip(),
        )

    def _collapse_description_parts(self, parts: list[str]) -> str:
        collapsed_parts: list[str] = []

        for part in parts:
            normalized = re.sub(r'\s+', ' ', part).strip()
            if not normalized:
                continue
            if collapsed_parts and (
                normalized == collapsed_parts[-1]
                or collapsed_parts[-1].endswith(f' {normalized}')
            ):
                continue
            collapsed_parts.append(normalized)

        return ' '.join(collapsed_parts)[:200]

    def _parse_php_amount(self, token: str) -> float:
        amount = float(token.replace('PHP', '').replace(',', ''))
        return amount

    def _parse_usd_amount(self, token: str) -> float:
        return float(token.replace('$', '').replace(',', ''))

    def _run_expense_data_migrations(self, connection: sqlite3.Connection) -> None:
        if self._migration_applied(connection, 'description_cleanup_v1'):
            return

        self._cleanup_existing_transaction_descriptions(connection)
        connection.execute(
            """
            INSERT OR REPLACE INTO exp_meta(key, value)
            VALUES(?, ?)
            """,
            ('description_cleanup_v1', datetime.now().isoformat()),
        )

    def _migration_applied(self, connection: sqlite3.Connection, key: str) -> bool:
        row = connection.execute(
            'SELECT 1 FROM exp_meta WHERE key = ? LIMIT 1',
            (key,),
        ).fetchone()
        return row is not None

    def _cleanup_existing_transaction_descriptions(
        self, connection: sqlite3.Connection
    ) -> None:
        rows = connection.execute(
            """
            SELECT t.id, t.description, a.name AS account_name
            FROM exp_transactions AS t
            LEFT JOIN exp_accounts AS a ON a.id = t.account_id
            """
        ).fetchall()

        for row in rows:
            cleaned = self._normalize_local_bank_description(
                row['description'] or '',
                account_name=row['account_name'] or '',
            )
            if cleaned and cleaned != row['description']:
                connection.execute(
                    'UPDATE exp_transactions SET description = ? WHERE id = ?',
                    (cleaned, int(row['id'])),
                )

    def _normalize_local_bank_description(
        self,
        description: str,
        counterparty: str = '',
        account_name: str = '',
    ) -> str:
        normalized_description = self._dedupe_repeated_phrase(description)
        normalized_counterparty = self._dedupe_repeated_phrase(counterparty)
        combined = ' '.join(
            part for part in [normalized_counterparty, normalized_description] if part
        ).strip()
        upper_combined = combined.upper()
        upper_description = normalized_description.upper()
        upper_account_name = account_name.upper()

        if not self._looks_like_local_bank_import(upper_combined, upper_description, upper_account_name):
            return normalized_description

        direct_replacements = [
            ('INTEREST WITHHELD', 'Interest withheld'),
            ('INTEREST PAY SYS-GEN', 'Interest payment'),
            ('PMMF PLACEMENT', 'PMMF placement'),
            ('W/D P BDO', 'BDO ATM withdrawal'),
            ('CASH WITHDRAWAL', 'ATM withdrawal'),
            ('SOFT HABIT', 'Soft Habit'),
            ('SM SUPERMA', 'SM Supermarket'),
            ('SM STORE', 'SM Store'),
            ('STARBUCKS', 'Starbucks'),
            ('SHOPEE', 'Shopee'),
            ('LAZADA', 'Lazada'),
            ('GRAB', 'Grab'),
            ('DECATHLON', 'Decathlon'),
            ('UNIQLO', 'Uniqlo'),
            ('MY HEALTH', 'My Health'),
            ('LUXENT HOT', 'Luxent Hotel'),
            ('METROBANK MAKATI', 'Metrobank Makati'),
            ('H&M', 'H&M'),
        ]
        for needle, replacement in direct_replacements:
            if needle in upper_combined:
                return replacement

        if 'SENT VIA INSTAPAY' in upper_combined or upper_description.startswith('POB IBFT BN-'):
            match = re.search(r'([A-Z]{3}\s+\*{4}\d{4})', upper_combined)
            if match:
                return f'InstaPay transfer to {match.group(1)}'
            return 'InstaPay transfer'

        cleaned = upper_description
        cleaned = re.sub(
            r'^(POS W/D SV|POS W/D|W/D P|SV|POS)\s+',
            '',
            cleaned,
        )
        cleaned = re.sub(r'\b(POS|ATP|MLIC|IBTW|SYS-GEN)\b', '', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip(' -')
        if not cleaned:
            cleaned = upper_description

        return self._smart_title_case(cleaned)

    def _looks_like_local_bank_import(
        self, combined: str, description: str, account_name: str
    ) -> bool:
        if any(marker in account_name for marker in ('BPI', 'BDO')):
            return True

        patterns = (
            'POS W/D',
            'SENT VIA INSTAPAY',
            'POB IBFT',
            'INTEREST WITHHELD',
            'INTEREST PAY',
            'W/D P BDO',
            'PMMF PLACEMENT',
        )
        return any(pattern in combined or pattern in description for pattern in patterns)

    def _dedupe_repeated_phrase(self, description: str) -> str:
        normalized = re.sub(r'\s+', ' ', (description or '').strip())
        if not normalized:
            return ''

        words = normalized.split(' ')
        if len(words) % 2 == 0:
            midpoint = len(words) // 2
            if words[:midpoint] == words[midpoint:]:
                return ' '.join(words[:midpoint])

        match = re.match(r'^(.+?)\s+\1$', normalized)
        if match:
            return match.group(1)

        return normalized

    def _smart_title_case(self, text: str) -> str:
        tokens = []
        replacements = {
            'Atm': 'ATM',
            'Bdo': 'BDO',
            'Bpi': 'BPI',
            'Pmmf': 'PMMF',
            'Sm': 'SM',
            'Gxi': 'GXI',
        }

        for token in text.split(' '):
            if not token:
                continue
            if '*' in token or token.isdigit():
                tokens.append(token)
                continue

            titled = token.lower().capitalize()
            tokens.append(replacements.get(titled, titled))

        return ' '.join(tokens)

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
