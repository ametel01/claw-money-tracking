from __future__ import annotations

import json
import shutil
from dataclasses import asdict
from pathlib import Path

import pytest

from dashboard.expenses_service import ExpensesService


FIXTURES_ROOT = Path(__file__).parent / 'fixtures' / 'statements'


def load_fixture(case_name: str) -> tuple[str, list[dict[str, object]]]:
    case_root = FIXTURES_ROOT / case_name
    statement_text = (case_root / 'input.txt').read_text(encoding='utf-8')
    expected_rows = json.loads((case_root / 'expected.json').read_text(encoding='utf-8'))
    return statement_text, expected_rows


@pytest.mark.parametrize(
    ('case_name'),
    [
        'generic_numeric',
        'revolut',
        'multiline',
        'bpi_account_activities_redacted',
        'revolut_usd_statement_redacted',
    ],
)
def test_parse_pdf_lines_matches_fixture(case_name: str) -> None:
    service = ExpensesService(Path(__file__).resolve().parents[1])
    statement_text, expected_rows = load_fixture(case_name)

    parsed_rows = service._parse_pdf_lines(statement_text.splitlines())

    assert [asdict(row) for row in parsed_rows] == expected_rows


def test_import_pdf_statement_deduplicates_fixture_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / 'workspace'
    (root / 'expenses').mkdir(parents=True)
    shutil.copy2(
        Path(__file__).resolve().parents[1] / 'expenses' / 'schema.sql',
        root / 'expenses' / 'schema.sql',
    )

    statement_text, expected_rows = load_fixture('multiline')
    service = ExpensesService(root)
    monkeypatch.setattr(service, '_extract_pdf_text', lambda _pdf_path: statement_text)

    first_import = service.import_pdf_statement('BPI USD Visa', 'statement.pdf', b'%PDF-1.4 fixture')
    second_import = service.import_pdf_statement('BPI USD Visa', 'statement.pdf', b'%PDF-1.4 fixture')

    assert first_import['ok'] is True
    assert first_import['parsedRows'] == len(expected_rows)
    assert first_import['insertedTransactions'] == len(expected_rows)

    assert second_import['ok'] is True
    assert second_import['parsedRows'] == len(expected_rows)
    assert second_import['insertedTransactions'] == 0

    with service.connect() as connection:
        rows = connection.execute(
            """
            SELECT tx_date, description, amount_original, currency
            FROM exp_transactions
            ORDER BY tx_date ASC, id ASC
            """
        ).fetchall()

    assert len(rows) == len(expected_rows)
    assert [row['tx_date'] for row in rows] == [entry['tx_date'] for entry in expected_rows]
    assert [row['description'] for row in rows] == [
        entry['description'] for entry in expected_rows
    ]
    assert [row['amount_original'] for row in rows] == [
        entry['amount'] for entry in expected_rows
    ]
    assert {row['currency'] for row in rows} == {'USD'}


def test_cleanup_existing_transaction_descriptions_normalizes_legacy_bank_rows(
    tmp_path: Path,
) -> None:
    root = tmp_path / 'workspace'
    (root / 'expenses').mkdir(parents=True)
    shutil.copy2(
        Path(__file__).resolve().parents[1] / 'expenses' / 'schema.sql',
        root / 'expenses' / 'schema.sql',
    )

    service = ExpensesService(root)
    service.ensure_schema()

    with service.connect() as connection:
        account_id = connection.execute(
            "INSERT INTO exp_accounts(name, currency) VALUES(?, ?)",
            ('BPI 012450074240', 'PHP'),
        ).lastrowid
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
              source_hash
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(account_id),
                '2026-02-28',
                'INTEREST PAY SYS-GEN INTEREST PAY SYS-GEN',
                4.15,
                'PHP',
                4.15,
                4.15,
                'legacy-interest',
            ),
        )
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
              source_hash
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(account_id),
                '2026-02-26',
                'POS W/D SV SOFT HABIT QUEZON CITY MLIC POS W/D SV SOFT HABIT QUEZON CITY MLIC',
                -320.0,
                'PHP',
                -320.0,
                -320.0,
                'legacy-soft-habit',
            ),
        )
        service._cleanup_existing_transaction_descriptions(connection)
        connection.commit()

        rows = connection.execute(
            """
            SELECT description
            FROM exp_transactions
            ORDER BY id ASC
            """
        ).fetchall()

    assert [row['description'] for row in rows] == ['Interest payment', 'Soft Habit']
