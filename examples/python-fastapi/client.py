"""
PaymentGatewayClient — wrapper untuk call gateway dari Python.

Drop file ini ke project FastAPI/Django/Flask Anda.
Pakai httpx (async + sync). Install: pip install httpx
"""
from __future__ import annotations

import asyncio
import random
import uuid
from dataclasses import dataclass
from typing import Any, Optional

import httpx


@dataclass
class PaymentGatewayError(Exception):
    status_code: int
    code: str
    message: str
    details: Any = None

    def __str__(self) -> str:
        return f"[{self.code}] {self.message} (HTTP {self.status_code})"


class PaymentGatewayClient:
    """Async client. Untuk Django/Flask sync, lihat sync_charge() di bawah."""

    def __init__(
        self,
        base_url: str,
        timeout_sec: float = 10.0,
        max_retries: int = 2,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.max_retries = max_retries

    async def charge(
        self,
        *,
        order_id: str,
        amount: int,
        currency: str,
        method: str,
        customer: dict[str, str],
        description: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        """Charge customer.

        method: credit_card | bank_transfer | ewallet | qris
        Idempotency key auto-generated kalau None.
        """
        body = {
            "orderId": order_id,
            "amount": amount,
            "currency": currency,
            "method": method,
            "customer": customer,
        }
        if description:
            body["description"] = description

        key = idempotency_key or f"{order_id}-{uuid.uuid4()}"
        return await self._request(
            "POST",
            "/api/v1/payments/charge",
            body=body,
            extra_headers={"Idempotency-Key": key},
        )

    async def get_by_id(self, transaction_id: str) -> dict[str, Any]:
        return await self._request(
            "GET", f"/api/v1/payments/{transaction_id}"
        )

    async def get_by_order_id(self, order_id: str) -> dict[str, Any]:
        return await self._request(
            "GET", f"/api/v1/payments?orderId={order_id}"
        )

    async def _request(
        self,
        method: str,
        path: str,
        body: Optional[dict[str, Any]] = None,
        extra_headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if extra_headers:
            headers.update(extra_headers)

        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_sec) as client:
                    res = await client.request(
                        method, url, headers=headers, json=body
                    )
                data = res.json() if res.text else {}
                if 200 <= res.status_code < 300:
                    return data.get("data", {})

                err = PaymentGatewayError(
                    status_code=res.status_code,
                    code=data.get("error", "REQUEST_FAILED"),
                    message=data.get("message", f"HTTP {res.status_code}"),
                    details=data.get("details"),
                )
                # Retry only on 5xx
                last_error = err
                if attempt == self.max_retries or res.status_code < 500:
                    raise err
            except httpx.HTTPError as e:
                last_error = e
                if attempt == self.max_retries:
                    raise

            delay = 0.2 * (2**attempt) + random.uniform(0, 0.1)
            await asyncio.sleep(delay)

        # Theoretically unreachable
        raise last_error or RuntimeError("Unknown gateway error")
