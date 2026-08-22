---
name: rubber-stamp-travel-field-note
description: Use for rubber-stamp travel field-note photo posters.
version: 1.0.0
author: BMO
license: CC-BY-4.0
metadata:
  hermes:
    tags: [image-generation, photo-editing, travel, poster]
    related_skills: []
---

# Rubber-Stamp Travel Field Note

Turn each supplied place photo into its own 4:3 landscape poster: a preserved editorial photograph on the left and a small, handmade, place-specific rubber-stamp memory on warm paper at right.

## When to Use

Use when the user asks to turn travel, architecture, landscape, or place photos into tactile field-note posters with simplified multicolor stamp impressions. Do not invoke for unrelated stamp, logo, or general travel-poster work.

## Route

1. Treat every source photo as an **edit target**, not loose inspiration.
2. Use an image-generation/editing tool that accepts image input. Prefer a built-in image-generation tool when available. In Codex, attach the image and invoke `$imagegen`; this uses the ChatGPT/Codex subscription allowance. Use an API/CLI route only when explicitly requested or when the built-in route is unavailable and credentials exist.
3. For multiple photos, generate one independent poster per photo. Never create a collage unless requested.
4. Load `references/poster-spec.md` and translate its constraints into the generation prompt. Fill only facts supported by the photo or user input; do not invent a location when uncertain.
5. Inspect every output against the acceptance checks. Iterate with one targeted correction at a time.

## Inputs

- One or more place/travel photos.
- Optional exact location, year, numbering order, and three keywords.
- If location text is uncertain, ask for it or omit it; visual generation is not a geolocation oracle wearing a beret.

## Acceptance checks

For every requested photo, verify all of these:

- Exactly one standalone 4:3 landscape poster exists.
- Left side occupies about 58% and preserves the source photograph's identity, geometry, subject relationships, lighting, and atmosphere; only natural cropping, restrained editorial grading, and very fine grain are allowed.
- Right side occupies about 42% and is warm off-white paper with subtle fibers, wear, matte texture, and generous blank space; there is no drawn divider.
- The stamp is small, in the lower-middle of the paper area, and simplifies the location to the minimum recognizable relationships rather than tracing every detail.
- The stamp uses 2–4 muted spot colors derived from the photo, with carved texture, missing ink, broken edges, paper show-through, pressure variation, slight ghosting, and 1–2 mm color misregistration.
- It does not resemble a smooth vector logo, generic tourist badge, complete illustration, sticker, wax seal, circular red seal, or digital filter.
- Text is short, correctly spelled, and limited to location, `No. NN`, three brief English keywords, and Gregorian year unless the user requests otherwise.
- People, architecture, terrain, and other identity-sensitive content on the photo side have not been redrawn or replaced.

## Output

Return the poster files in input order. State the route used, list any uncertain metadata, and identify any acceptance check that could not be verified. Preserve the final prompt with the output so the result can be reproduced or refined.

## Provenance

Adapted from the field-note poster prompt and examples shared by @Hamburgerai: https://x.com/hamburgerai/status/2090683415104557406
