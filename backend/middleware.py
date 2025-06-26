import os
from hmac import compare_digest

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_403_FORBIDDEN


class CloudflareServiceTokenMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, skip_paths: set[str] | None = None):
        super().__init__(app)
        self.expected_id = os.environ["CF_ACCESS_CLIENT_ID"]
        self.expected_secret = os.environ["CF_ACCESS_CLIENT_SECRET"]
        self.skip_paths = skip_paths or {"/docs", "/openapi.json", "/"}

    async def dispatch(self, request, call_next):
        if request.url.path in self.skip_paths or os.getenv("CF_CHECK", "true") != "true":
            return await call_next(request)

        cid = request.headers.get("Cf-Access-Client-Id")
        csec = request.headers.get("Cf-Access-Client-Secret")

        if cid is None or csec is None:
            raise HTTPException(HTTP_401_UNAUTHORIZED, "Missing CF service-token headers")

        # constant-time compare
        if not (compare_digest(cid, self.expected_id) and
                compare_digest(csec, self.expected_secret)):
            raise HTTPException(HTTP_403_FORBIDDEN, "Invalid service token")

        return await call_next(request)
