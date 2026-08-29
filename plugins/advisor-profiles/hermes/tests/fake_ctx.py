from __future__ import annotations

from typing import Any, Dict, List, Optional


class FakeState:
    def __init__(self) -> None:
        self.data: Dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value


class FakeLlmResult:
    def __init__(self, parsed: Any = None, text: str = "") -> None:
        self.parsed = parsed
        self.text = text


class FakeLlm:
    def __init__(self, results: Optional[List[Any]] = None, error: Optional[Exception] = None) -> None:
        self.results = list(results or [])
        self.error = error
        self.calls: List[Dict[str, Any]] = []

    def complete_structured(self, **kwargs: Any) -> FakeLlmResult:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        if self.results:
            return self.results.pop(0)
        return FakeLlmResult(parsed=None)


class FakeCtx:
    def __init__(
        self,
        capability: bool = False,
        capabilities: Optional[Dict[str, bool]] = None,
        llm: Optional[FakeLlm] = None,
        state: Optional[FakeState] = None,
    ) -> None:
        self.has_capability_value = capability
        self.capabilities = dict(capabilities or {})
        self.llm = llm if llm is not None else FakeLlm()
        self.state = state if state is not None else FakeState()
        self.hooks: Dict[str, List[Any]] = {}
        self.commands: Dict[str, Dict[str, Any]] = {}
        self.injected: List[str] = []
        self.inject_result = True

    def register_hook(self, name: str, callback: Any) -> None:
        self.hooks.setdefault(name, []).append(callback)

    def register_command(self, name: str, handler: Any, description: str = "", args_hint: str = "") -> None:
        self.commands[name] = {"handler": handler, "description": description, "args_hint": args_hint}

    def has_capability(self, capability: str) -> bool:
        return self.capabilities.get(capability, self.has_capability_value)

    def inject_message(self, content: str, role: str = "user", **kwargs: Any) -> bool:
        self.injected.append(content)
        return self.inject_result
