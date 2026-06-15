from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass


_operation_id_var: ContextVar[str | None] = ContextVar("nicknotes_operation_id", default=None)
_trace_id_var: ContextVar[str | None] = ContextVar("nicknotes_trace_id", default=None)
_vault_id_var: ContextVar[str | None] = ContextVar("nicknotes_vault_id", default=None)


@dataclass(frozen=True)
class OperationContext:
    operation_id: str | None = None
    trace_id: str | None = None
    vault_id: str | None = None


def set_operation_context(
    *,
    operation_id: str | None,
    trace_id: str | None = None,
    vault_id: str | None = None,
) -> tuple[object, object, object]:
    operation_token = _operation_id_var.set(operation_id)
    trace_token = _trace_id_var.set(trace_id)
    vault_token = _vault_id_var.set(vault_id)
    return (operation_token, trace_token, vault_token)


def clear_operation_context(tokens: tuple[object, object, object]) -> None:
    operation_token, trace_token, vault_token = tokens
    _operation_id_var.reset(operation_token)
    _trace_id_var.reset(trace_token)
    _vault_id_var.reset(vault_token)


def get_operation_context() -> OperationContext:
    return OperationContext(
        operation_id=_operation_id_var.get(),
        trace_id=_trace_id_var.get(),
        vault_id=_vault_id_var.get(),
    )
