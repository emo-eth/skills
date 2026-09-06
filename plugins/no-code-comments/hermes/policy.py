NO_CODE_COMMENTS_PROMPT = (
    "No-code-comments is active in advisory mode. Prefer self-explanatory code "
    "without prose comments. Semantic directives, shebangs, compiler annotations, "
    "and source-map directives are unaffected."
)


def policy() -> str:
    return NO_CODE_COMMENTS_PROMPT
