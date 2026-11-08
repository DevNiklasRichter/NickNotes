"""Local transport boundary. Domain permissions remain in the application layer."""
from __future__ import annotations

import hmac
import os
import secrets
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

INTERNAL_TOKEN = os.environ.get("NICKNOTES_API_TOKEN") or secrets.token_urlsafe(32)
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173", "nicknotes://app"}
MAX_REQUEST_BYTES = 30 * 1024 * 1024


class LocalApiSecurity:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = {k.decode('latin1').lower(): v.decode('latin1') for k, v in scope['headers']}
        try:
            host = urlsplit('http://' + headers.get('host', '')).hostname
        except ValueError:
            host = None
        origin = headers.get('origin')
        status, message = 0, ''
        if host not in {'127.0.0.1', 'localhost', '::1'}:
            status, message = 403, 'Host is not allowed.'
        elif origin and origin not in ALLOWED_ORIGINS:
            status, message = 403, 'Origin is not allowed.'
        elif not (scope['path'] == '/mcp' or scope['path'].startswith('/mcp/')) and scope['method'] != 'OPTIONS':
            supplied = headers.get('authorization', '').removeprefix('Bearer ')
            if not hmac.compare_digest(supplied.encode('utf-8'), INTERNAL_TOKEN.encode('utf-8')):
                status, message = 401, 'App authentication required.'
        try:
            if int(headers.get('content-length', '0')) > MAX_REQUEST_BYTES:
                status, message = 413, 'Request is too large.'
        except ValueError:
            status, message = 400, 'Invalid content length.'
        if status:
            return await JSONResponse({'ok': False, 'error': {'code': 'access.denied', 'message': message}}, status_code=status)(scope, receive, send)
        # Also bound chunked bodies before parsing/decoding them.
        body, total = [], 0
        while True:
            item = await receive()
            if item['type'] == 'http.disconnect':
                return
            total += len(item.get('body', b''))
            if total > MAX_REQUEST_BYTES:
                return await JSONResponse({'error': {'code': 'request.tooLarge', 'message': 'Request is too large.'}}, status_code=413)(scope, receive, send)
            body.append(item)
            if not item.get('more_body'):
                break
        async def bounded_receive():
            if body:
                return body.pop(0)
            return await receive()
        await self.app(scope, bounded_receive, send)
