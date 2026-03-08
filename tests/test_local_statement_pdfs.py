from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest

from dashboard.expenses_service import ExpensesService


BPI_PDF_PATH = Path(
    os.environ.get('BPI_ACCOUNT_ACTIVITIES_PDF', '/home/ametel/Downloads/Account Activities.pdf')
)
REVOLUT_PDF_PATH = Path(
    os.environ.get(
        'REVOLUT_USD_STATEMENT_PDF',
        '/home/ametel/Downloads/account-statement_2026-01-01_2026-02-28_en-us_ca0fff.pdf',
    )
)


def _extract_pdf_text(path: Path) -> str:
    if not shutil.which('pdftotext'):
        pytest.skip('pdftotext is required for local PDF smoke tests')

    return subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)


def test_local_bpi_pdf_parses_current_account_format() -> None:
    if not BPI_PDF_PATH.exists():
        pytest.skip(f'local PDF not found: {BPI_PDF_PATH}')

    service = ExpensesService(Path(__file__).resolve().parents[1])
    rows = service._parse_pdf_lines(_extract_pdf_text(BPI_PDF_PATH).splitlines())

    assert len(rows) >= 80
    assert any(row.amount > 0 for row in rows)
    assert any(row.amount < 0 for row in rows)
    assert all(row.description for row in rows)
    assert any(row.description == 'Soft Habit' for row in rows)
    assert any(row.description.startswith('InstaPay transfer to ') for row in rows)
    assert any(row.description == 'Interest payment' for row in rows)
    assert all('Account number' not in row.description for row in rows)
    assert all('Available balance' not in row.description for row in rows)
    assert all('Page ' not in row.description for row in rows)
    assert all('POS W/D SV' not in row.description for row in rows)
    assert all('POB IBFT' not in row.description for row in rows)


def test_local_revolut_pdf_parses_usd_statement_format() -> None:
    if not REVOLUT_PDF_PATH.exists():
        pytest.skip(f'local PDF not found: {REVOLUT_PDF_PATH}')

    service = ExpensesService(Path(__file__).resolve().parents[1])
    rows = service._parse_pdf_lines(_extract_pdf_text(REVOLUT_PDF_PATH).splitlines())

    assert len(rows) >= 60
    assert any(row.amount > 0 for row in rows)
    assert any(row.amount < 0 for row in rows)
    assert any(row.description == 'Withdrawing savings' for row in rows)
    assert any(row.description.startswith('Transfer from ') for row in rows)
    assert all('Revolut Rate' not in row.description for row in rows)
    assert all('Card:' not in row.description for row in rows)
    assert all('Fee:' not in row.description for row in rows)
