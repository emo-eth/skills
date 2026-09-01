from __future__ import annotations

from .strip_comments import NO_CODE_COMMENTS_PROMPT, rewrite_tool_args


def _rewrite(tool_name: str, args: dict, **kwargs):
    del kwargs
    result = rewrite_tool_args(tool_name, args)
    if result.block:
        return None
    if result.args is None:
        return None
    return {
        "args": result.args,
        "source": "no-code-comments",
        "reason": f"removed {result.removed} prose comment(s)",
    }




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
    ctx.register_middleware("tool_request", _rewrite)
    ctx.register_command(
        "no-code-comments",
        handler=_show_policy,
        description="Show the deterministic no-code-comments policy",
    )
