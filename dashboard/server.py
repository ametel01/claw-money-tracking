#!/usr/bin/env python3
from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
from urllib.parse import parse_qs, urlparse

from expenses_service import ExpensesService


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = ROOT / 'public'
PORT = int(os.environ.get('PORT', '8081'))


class MoneyDashboardHandler(SimpleHTTPRequestHandler):
    service = ExpensesService(ROOT)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == '/':
            self.send_response(302)
            self.send_header('Location', '/expenses/')
            self.end_headers()
            return

        if parsed.path == '/api/expenses/overview':
            self._handle_json(lambda: self.service.get_overview())
            return

        if parsed.path == '/api/expenses/fx':
            self._handle_json(lambda: self.service.list_fx_rates())
            return

        if parsed.path == '/api/expenses/transactions':
            query = parse_qs(parsed.query)
            limit = self._safe_int((query.get('limit') or ['50'])[0], default=50, minimum=1, maximum=400)
            self._handle_json(lambda: self.service.list_transactions(limit))
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == '/api/expenses/fx-rate':
            body = self._read_json_body()
            self._handle_json(
                lambda: self.service.upsert_fx_rate(
                    body.get('base') or 'USD',
                    body.get('quote') or 'PHP',
                    float(body.get('rate') or 0),
                    body.get('date'),
                )
            )
            return

        if parsed.path == '/api/expenses/fx-backfill':
            self._handle_json(lambda: self.service.backfill_fx())
            return

        if parsed.path == '/api/expenses/import-pdf':
            fields, files = self._parse_multipart_form()
            file_item = files.get('file')

            if not file_item or not file_item.get('filename'):
                self._send_json(400, {'ok': False, 'error': 'file field is required'})
                return

            if Path(file_item['filename']).suffix.lower() != '.pdf':
                self._send_json(400, {'ok': False, 'error': 'only PDF supported'})
                return

            account_name = (fields.get('accountName') or 'Default Account').strip()
            self._handle_json(
                lambda: self.service.import_pdf_statement(
                    account_name,
                    str(file_item['filename']),
                    file_item['content'],
                )
            )
            return

        self._send_json(404, {'ok': False, 'error': 'not found'})

    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _handle_json(self, operation) -> None:
        try:
            payload = operation()
            self._send_json(200, payload)
        except ValueError as error:
            self._send_json(400, {'ok': False, 'error': str(error)})
        except Exception as error:
            self._send_json(500, {'ok': False, 'error': str(error)})

    def _read_json_body(self) -> dict[str, object]:
        length = int(self.headers.get('Content-Length', '0') or 0)
        raw = self.rfile.read(length) if length > 0 else b'{}'

        try:
            payload = json.loads(raw.decode('utf-8') or '{}')
        except json.JSONDecodeError as error:
            raise ValueError('invalid JSON body') from error

        if isinstance(payload, dict):
            return payload

        raise ValueError('JSON object body required')

    def _parse_multipart_form(self) -> tuple[dict[str, str], dict[str, dict[str, object]]]:
        content_type = self.headers.get('content-type', '') or ''
        boundary_match = re.search(r'boundary=(.+)', content_type)
        if 'multipart/form-data' not in content_type.lower() or not boundary_match:
            raise ValueError('multipart/form-data required')

        boundary = boundary_match.group(1).strip().strip('"')
        content_length = int(self.headers.get('content-length', '0') or 0)
        raw_body = self.rfile.read(content_length)
        boundary_bytes = f'--{boundary}'.encode('utf-8')
        fields: dict[str, str] = {}
        files: dict[str, dict[str, object]] = {}

        for part in raw_body.split(boundary_bytes):
            stripped_part = part.strip()
            if not stripped_part or stripped_part == b'--':
                continue
            if stripped_part.startswith(b'--'):
                stripped_part = stripped_part[2:]
            if stripped_part.startswith(b'\r\n'):
                stripped_part = stripped_part[2:]

            header_blob, separator, body = stripped_part.partition(b'\r\n\r\n')
            if not separator:
                continue

            body = body.rstrip(b'\r\n')
            headers = header_blob.decode('utf-8', errors='ignore').split('\r\n')
            disposition = next(
                (
                    header
                    for header in headers
                    if header.lower().startswith('content-disposition:')
                ),
                '',
            )
            name_match = re.search(r'name="([^"]+)"', disposition)
            if not name_match:
                continue

            name = name_match.group(1)
            filename_match = re.search(r'filename="([^"]*)"', disposition)
            if filename_match and filename_match.group(1):
                files[name] = {
                    'filename': filename_match.group(1),
                    'content': body,
                }
                continue

            fields[name] = body.decode('utf-8', errors='ignore')

        return fields, files

    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _safe_int(self, raw: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return default

        return max(minimum, min(maximum, value))


def main() -> None:
    PUBLIC_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('0.0.0.0', PORT), MoneyDashboardHandler)
    print(f'Serving money dashboard on http://127.0.0.1:{PORT}/expenses/')
    server.serve_forever()


if __name__ == '__main__':
    main()
