from __future__ import annotations

import copy
import json
import re
import urllib.parse


ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "relation",
        "url",
        "authorHandle",
        "authorName",
        "timestamp",
        "text",
        "media",
        "links",
    ],
    "properties": {
        "relation": {
            "type": "string",
            "enum": ["anchor", "authored", "parent", "quote", "reply", "quote_reaction"],
        },
        "url": {"type": "string"},
        "authorHandle": {"type": "string"},
        "authorName": {"type": "string"},
        "timestamp": {"type": "string"},
        "text": {"type": "string"},
        "media": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "url", "description"],
                "properties": {
                    "type": {"type": "string"},
                    "url": {"type": "string"},
                    "description": {"type": "string"},
                },
            },
        },
        "links": {"type": "array", "items": {"type": "string"}},
    },
}

FETCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "requestedUrl",
        "content",
        "available",
        "contentKind",
        "failureReason",
        "anchor",
        "authoredContextAvailable",
        "authoredContext",
        "relatedContext",
        "discussion",
    ],
    "properties": {
        "requestedUrl": {"type": "string"},
        "content": {"type": "string", "enum": ["anchor", "authored"]},
        "available": {"type": "boolean"},
        "contentKind": {"type": "string", "enum": ["post", "article", "unknown"]},
        "failureReason": {"type": "string"},
        "anchor": {"anyOf": [{"$ref": "#/$defs/item"}, {"type": "null"}]},
        "authoredContextAvailable": {"type": "boolean"},
        "authoredContext": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "relatedContext": {"type": "array", "items": {"$ref": "#/$defs/item"}},
        "discussion": {
            "type": "object",
            "additionalProperties": False,
            "required": ["included", "sampleNotice", "viewpoints"],
            "properties": {
                "included": {"type": "boolean"},
                "sampleNotice": {"type": "string"},
                "viewpoints": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["theme", "summary", "examples"],
                        "properties": {
                            "theme": {"type": "string"},
                            "summary": {"type": "string"},
                            "examples": {
                                "type": "array",
                                "items": {"$ref": "#/$defs/item"},
                            },
                        },
                    },
                },
            },
        },
    },
    "$defs": {"item": ITEM_SCHEMA},
}


def build_search_prompt(query: str, sources: bool, depth: str) -> str:
    evidence = (
        "Use only live X content retrieved for this request. "
        "Never substitute model memory for absent live evidence. "
        "If evidence is sparse, conflicting, or absent, say exactly what could and could not be established. "
        "Never claim what all of X thinks, invent population percentages, or equate high engagement with consensus."
    )
    if sources:
        output = (
            "Return only concrete source entries for the calling agent to synthesize. "
            "For every source include author handle, date, exact post text, and canonical X URL. "
            "Do not add conclusions or unsupported commentary."
        )
    else:
        output = (
            "Produce a concise synthesis grounded only in the retrieved X posts. "
            "Keep interpretations separate from quoted evidence and preserve the source URLs needed to inspect the answer."
        )
    if depth == "deep":
        depth_instruction = (
            "Map representative viewpoints, agreement, disagreement, corrections, and notable reactions. "
            "Use concrete posts for every material theme and state that the retrieved view is bounded rather than exhaustive."
        )
    else:
        depth_instruction = "Answer at lightweight everyday depth and avoid unnecessary search expansion."
    return f"{query}\n\n{evidence} {depth_instruction} {output}"


def build_fetch_prompt(url: str, content: str, discussion: bool) -> str:
    identity = _x_identity(url)
    status_id = identity[1] if identity and identity[0] == "status" else None
    if content == "authored":
        authored = (
            "Return the complete author-composed unit in order, excluding other people's replies from authoredContext. "
            "Actively search for same-author self-replies or continuations whose conversation includes the anchor; do not treat the anchor alone as evidence that the authored unit is complete."
        )
        if status_id:
            authored += (
                f" After resolving the anchor author's actual handle, run an X keyword search using conversation_id:{status_id} from:<actual handle> "
                "so every same-author continuation is separately encountered and cited."
            )
    else:
        authored = "Return only the anchor as authored content and set authoredContextAvailable when more author-composed content exists."
    if discussion:
        discussion_instruction = (
            "Include a bounded representative discussion showing material interpretations, agreement, disagreement, corrections, and notable reactions. "
            "Every viewpoint needs concrete examples. Actively retrieve concrete reply or quote-post reaction X objects, cite every returned example, and set sampleNotice to explain that the sample is not exhaustive."
        )
        if status_id:
            discussion_instruction += (
                f" Run X keyword searches using quoted_tweet_id:{status_id} and in_reply_to_status_id:{status_id} "
                "so every discussion example is separately encountered and cited. In discussion examples, label direct replies with relation reply "
                "and quote-post reactions with relation quote_reaction; relation quote is only for a post embedded by the anchor."
            )
    else:
        discussion_instruction = "Do not retrieve general replies or quote-post reactions. Set discussion.included false, sampleNotice empty, and viewpoints empty."
    return (
        f"Retrieve this exact X object with x_search: {url}\n"
        "Return the structured object required by the response schema. "
        "The anchor text and every retrieved post text must be complete and verbatim, never summarized or paraphrased. "
        "If the anchor is an X Article or its primary content is an X Article, return the full article title and body in anchor.text and set contentKind to article. "
        "Preserve author handles, display names, timestamps, canonical URLs, links, media types, media URLs, and useful media descriptions. "
        "Put directly referenced parent and quoted posts in relatedContext with their correct relation. "
        f"{authored} {discussion_instruction} "
        "Only include an X object in authoredContext, relatedContext, or discussion examples when x_search returned that exact object as live evidence so its URL appears in citations. "
        "Never mix replies or quote reactions into the anchor author's words. "
        "If the exact object is inaccessible, set available false, anchor null, all context arrays empty, discussion empty, and state the access failure without reconstructing the object from indirect traces."
    )


def fetch_response_format() -> dict:
    return {
        "format": {
            "type": "json_schema",
            "name": "x_retrieval",
            "strict": True,
            "schema": copy.deepcopy(FETCH_SCHEMA),
        }
    }


def parse_fetch_document(text: str) -> dict:
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("structured retrieval is not an object")
    return value


def _x_identity(value: str) -> tuple[str, str] | None:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme != "https" or parsed.hostname not in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}:
        return None
    status = re.search(r"/status/(\d+)", parsed.path)
    if status:
        return "status", status.group(1)
    article = re.search(r"/i/article/(\d+)", parsed.path)
    if article:
        return "article", article.group(1)
    return None


def _unavailable_fetch(url: str, content: str, reason: str) -> dict:
    return {
        "requestedUrl": url,
        "content": content,
        "available": False,
        "contentKind": "unknown",
        "failureReason": reason,
        "anchor": None,
        "authoredContextAvailable": False,
        "authoredContext": [],
        "relatedContext": [],
        "discussion": {"included": False, "sampleNotice": "", "viewpoints": []},
    }


def _author_identity(value: object) -> str | None:
    candidate = str(value or "").strip().removeprefix("@")
    return candidate.casefold() if re.fullmatch(r"[A-Za-z0-9_]{1,15}", candidate) else None


def _empty_discussion() -> dict:
    return {"included": False, "sampleNotice": "", "viewpoints": []}


def _verified_items(
    values: object,
    allowed_relations: frozenset[str],
    cited_identities: set[tuple[str, str]],
    author_identity: str | None = None,
    author_mode: str = "any",
    excluded_identity: tuple[str, str] | None = None,
) -> tuple[list[dict], bool]:
    accepted: list[dict] = []
    rejected = not isinstance(values, list)
    for value in values if isinstance(values, list) else []:
        if not isinstance(value, dict):
            rejected = True
            continue
        identity = _x_identity(str(value.get("url") or ""))
        relation = str(value.get("relation") or "")
        item_author = _author_identity(value.get("authorHandle"))
        author_matches = (
            author_mode == "any"
            or author_mode == "same" and author_identity is not None and item_author == author_identity
            or author_mode == "different" and author_identity is not None and item_author is not None and item_author != author_identity
        )
        if (
            identity is None
            or identity == excluded_identity
            or identity not in cited_identities
            or relation not in allowed_relations
            or not author_matches
        ):
            rejected = True
            continue
        accepted.append(value)
    return accepted, rejected


def enforce_live_fetch(
    document: dict,
    citations: list[dict],
    url: str,
    content: str,
    discussion_requested: bool = False,
) -> tuple[dict, list[str], bool]:
    document["requestedUrl"] = url
    document["content"] = content
    warnings: list[str] = []
    requested_identity = _x_identity(url)
    anchor = document.get("anchor")
    anchor_identity = _x_identity(str(anchor.get("url") or "")) if isinstance(anchor, dict) else None
    cited_identities = {
        identity
        for citation in citations
        if isinstance(citation, dict)
        for identity in [_x_identity(str(citation.get("url") or ""))]
        if identity is not None
    }
    if (
        requested_identity is None
        or anchor_identity != requested_identity
        or requested_identity not in cited_identities
    ):
        reason = "No live X citation verified the requested object."
        warnings.append("The requested object could not be verified against live X evidence.")
        return _unavailable_fetch(url, content, reason), warnings, True
    if document.get("available") is not True or not isinstance(anchor, dict):
        reason = str(document.get("failureReason") or "The requested X object is inaccessible.")
        warnings.append(reason)
        return _unavailable_fetch(url, content, reason), warnings, True

    anchor["relation"] = "anchor"
    author_identity = _author_identity(anchor.get("authorHandle"))
    authored_values = document.get("authoredContext")
    if isinstance(authored_values, list):
        authored_values = [
            item
            for item in authored_values
            if not (
                isinstance(item, dict)
                and _x_identity(str(item.get("url") or "")) == anchor_identity
            )
        ]
    authored, rejected_authored = _verified_items(
        authored_values,
        frozenset({"authored"}),
        cited_identities,
        author_identity,
        "same",
        anchor_identity,
    )
    if authored:
        document["authoredContextAvailable"] = True
    document["authoredContext"] = authored if content == "authored" else []
    if rejected_authored:
        warnings.append("The authored context contained uncited or misclassified items and was reduced to cited same-author content.")

    related, rejected_related = _verified_items(
        document.get("relatedContext"),
        frozenset({"parent", "quote"}),
        cited_identities,
        excluded_identity=anchor_identity,
    )
    document["relatedContext"] = related
    if rejected_related:
        warnings.append("The related context contained uncited or misclassified items and was reduced to cited parent and quote content.")

    if content == "authored" and not document.get("authoredContext"):
        warnings.append(
            "The full authored unit was requested but no additional cited author-composed content was recovered, so completeness could not be verified."
        )

    discussion = document.get("discussion")
    if not discussion_requested:
        document["discussion"] = _empty_discussion()
    elif (
        not isinstance(discussion, dict)
        or discussion.get("included") is not True
        or not str(discussion.get("sampleNotice") or "").strip()
        or not isinstance(discussion.get("viewpoints"), list)
    ):
        document["discussion"] = _empty_discussion()
        warnings.append("Representative discussion was requested but no cited, bounded sample was recovered.")
    else:
        viewpoints: list[dict] = []
        rejected_discussion = False
        for viewpoint in discussion["viewpoints"]:
            if not isinstance(viewpoint, dict):
                rejected_discussion = True
                continue
            examples, rejected_examples = _verified_items(
                viewpoint.get("examples"),
                frozenset({"reply", "quote_reaction"}),
                cited_identities,
                author_identity,
                "different",
                anchor_identity,
            )
            theme = str(viewpoint.get("theme") or "").strip()
            summary = str(viewpoint.get("summary") or "").strip()
            if not theme or not summary or not examples:
                rejected_discussion = True
                continue
            rejected_discussion = rejected_discussion or rejected_examples
            viewpoints.append({**viewpoint, "examples": examples})
        if not viewpoints:
            document["discussion"] = _empty_discussion()
            warnings.append("Representative discussion was requested but no cited, bounded sample was recovered.")
        else:
            document["discussion"] = {**discussion, "viewpoints": viewpoints}
            if rejected_discussion:
                warnings.append("The discussion contained uncited or misclassified examples and was reduced to cited reply and quote-reaction evidence.")
    return document, warnings, bool(warnings)
