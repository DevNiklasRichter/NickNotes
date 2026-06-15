from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base class for all structured domain failures."""

    status_code: int = 500
    error_code: str = "domain.error"

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        operation: str | None = None,
        vault_id: str | None = None,
        internal_message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.public_message = message
        self.internal_message = internal_message
        self.status_code = status_code or self.status_code
        self.error_code = error_code or self.error_code
        self.operation = operation
        self.vault_id = vault_id
        self.details = details or {}


class ValidationDomainError(DomainError):
    """Client input is invalid or violates a rule."""

    status_code = 400
    error_code = "request.validation"


class NotFoundDomainError(DomainError):
    """A required resource cannot be found."""

    status_code = 404
    error_code = "resource.notFound"


class ConflictDomainError(DomainError):
    """Operation cannot be executed due to conflict."""

    status_code = 409
    error_code = "request.conflict"


class InfrastructureDomainError(DomainError):
    """Unexpected infrastructure-level runtime failure."""

    status_code = 500
    error_code = "service.unexpected"
