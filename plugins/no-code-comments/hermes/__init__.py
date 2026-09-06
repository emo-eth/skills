from __future__ import annotations

from .policy import NO_CODE_COMMENTS_PROMPT


def _show_policy(raw_args: str) -> str:
    if raw_args.strip():
        return "Usage: /no-code-comments"
    return NO_CODE_COMMENTS_PROMPT


def register(ctx) -> None:
    ctx.register_system_prompt_section(
        "no-code-comments.policy",
        NO_CODE_COMMENTS_PROMPT,
        position="after_memory",
        max_chars=500,
    )
    ctx.register_command(
        "no-code-comments",
        handler=_show_policy,
        description="Show the no-code-comments advisory policy",
    )
