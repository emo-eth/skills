---
date: 2026-09-02
topic: grok-search
status: approved
source_material: User ideal-reality dump and north-star interview
---

# Glossary

- **Calling agent**: The active Pi or OMP model using grok-search within the user's current conversation.
- **Anchor**: The exact X object identified by a supplied URL.
- **Authored context**: Content written by the anchor's author that forms the complete authored unit, such as the rest of a thread or an X Article.
- **Discussion context**: Content from other people around the anchor, including replies, quote-post reactions, corrections, and competing interpretations.
- **Direct retrieval**: Fetching a specific X post, thread, or X Article for the calling agent.
- **Discovery**: Searching live X for sources, reactions, narratives, or sentiment related to a question.
- **Representative view**: A bounded set of concrete posts that shows material viewpoints without claiming to be exhaustive or statistically representative of all X users.
- **Subscription OAuth**: Authorization backed by the user's Grok, SuperGrok, or X subscription rather than billed xAI API access.

# Grok-search Vibe

## Vibe Promise

Grok-search should feel like the agent has fresh, trustworthy awareness of the live X ecosystem. A specific X URL should become faithfully readable despite X's resistance to ordinary web retrieval, while an open-ended question should produce a bounded view of what people are saying and why. The agent should choose the right mode, depth, and synthesis path without making the user operate a separate Grok product. Retrieval stays faithful, discovery stays honest about its sample, evidence remains available when requested, and installation or authentication mechanics recede from normal use.

## Ideal Reality Dump

- “This needs to be the agent's view into the X ecosystem.”
- It has two equal core modes: direct retrieval of specific X content, and live X search, source-finding, sentiment, and synthesis.
- It is not just “pull tweet text.” Sometimes the anchor text is all I want; other times I want the full authored thread, quoted posts, media, or to see what people are discussing around it.
- If the anchor is part of an authored thread, the agent should know that more authored context exists even when it initially retrieves only the anchor.
- Direct retrieval should return faithful full context to the model rather than quietly substituting a summary.
- Discussion expansion should show representative viewpoints, not merely the most popular replies or an unbounded raw scrape.
- The ordinary experience should be fresh X awareness: the agent knows when X is the relevant source and uses it without tool ceremony.
- Normal answers can stay clean. Sources should remain available when I ask for them rather than appearing as a mandatory source dump every time.
- Sentiment must be qualitative and bounded. A searched sample is not permission to claim what all of X thinks.
- Installation should install the capability, not force authentication.
- Existing supported Grok authentication should be reused before asking me to log in again.
- If login is needed, the agent should offer and run the device flow after I approve. Nobody is going to know where the Python script is, and I am not going to learn.
- Prefer subscription access. Never turn quota exhaustion into surprise API billing.
- Do not overdesign rare forensic recovery or hypothetical size limits. Make the common paths excellent and failures truthful.

## Use Circumstances

- The user pastes an X post URL and expects the calling agent to read the exact post and its metadata.
- The user supplies a thread or X Article and needs the complete authored content in order.
- The user wants only the anchor but needs to know whether more authored context is available.
- The user asks what a post means in context and the agent expands parent posts, quotes, media, or surrounding discussion.
- The user asks what people on X are saying about a topic, account, event, product, or claim.
- The user asks for sentiment, disagreement, corrections, representative reactions, or good primary sources from X.
- The request is lightweight and immediate, or broad, high-stakes, or fast-moving enough to warrant deeper discovery.
- The agent needs current X evidence that ordinary web retrieval cannot access reliably.
- Grok-search is installed in Pi or OMP with reusable authorization, missing authorization, expired authorization, or exhausted subscription quota.

## Vibe Clauses

### V1. Fresh X awareness, not tool ceremony

- Promise: The user should experience an agent that can see live X when relevant, not a separate product that must be operated manually.
- Means: The calling agent recognizes specific X URLs, distinguishes direct retrieval from discovery, and adapts search depth to the request without requiring tool names or setup knowledge from the user.
- Does not mean: Grok-search becomes a general web-search tool, a plain Grok chat interface, or an excuse to query X when X is not relevant.
- Violation: The user must explicitly choose Grok, translate a natural request into tool arguments, or leave the conversation to retrieve ordinary X content.
- Check: Give the agent a specific X URL and a separate natural-language question about live X. It should choose direct retrieval for the first and discovery for the second without being told which tool to use.

### V2. Faithful direct retrieval

- Promise: A requested X object should reach the calling agent as source content rather than as Grok's opinion about that content.
- Means: Anchor retrieval preserves the complete available text, author, timestamp, links, media context, and parent or quote relationships. Full-authored retrieval preserves an entire authored thread or X Article in order.
- Does not mean: Every URL fetch must automatically expand the complete authored unit or surrounding discussion. Anchor-only retrieval is valid when it also signals that more authored context exists.
- Violation: The extension silently paraphrases the anchor, drops material authored content, flattens thread order, or presents a summary as though it were the source.
- Check: Retrieve an anchor from an authored thread, then retrieve the full authored context. The first must identify that expansion is available; the second must preserve the complete authored unit and its order.

### V3. An expandable view of the X ecosystem

- Promise: The agent should be able to move from an anchor into the context that makes it understandable.
- Means: It can inspect authored context, parents, quoted posts, media, links, replies, quote-post reactions, and representative discussion while preserving who said what and how each object relates to the anchor.
- Does not mean: Every fetch becomes an exhaustive conversation crawl, or content from other people is mixed into the anchor author's words.
- Violation: Grok-search behaves like a thin tweet-text scraper, or the calling agent cannot distinguish the authored thread from replies and reactions around it.
- Check: Start from a post whose meaning depends on a parent, quote, media item, authored continuation, and contested replies. The calling agent must be able to inspect each layer without losing provenance.

### V4. Representative, bounded discovery

- Promise: Search should reveal the material contours of a live X conversation without pretending that a retrieved sample is the whole platform.
- Means: Discovery adapts from lightweight context gathering to deeper source and narrative analysis. It surfaces concrete examples of major interpretations, agreement, disagreement, corrections, and notable reactions.
- Does not mean: Highest engagement equals representative evidence, all viewpoints deserve equal weight, or a bounded search can produce a statistically valid measure of X as a whole.
- Violation: The extension reports “X thinks,” invents population percentages, equates popularity with consensus, or substitutes Grok memory for absent live evidence.
- Check: Ask for sentiment around a contested topic. The result must describe themes and disagreement qualitatively, remain bounded to retrieved evidence, and state when evidence is sparse or conflicting.

### V5. Adaptive synthesis with recoverable evidence

- Promise: The final answer should fit the user's task while remaining traceable to live X material.
- Means: The calling agent normally synthesizes when surrounding conversation matters; Grok may provide X-native synthesis for broad narrative, source-finding, or sentiment work. Direct retrieval remains source delivery. Supporting posts remain recoverable when the user asks for them.
- Does not mean: Every answer must display a source list, the calling agent must always synthesize, or Grok's polished prose becomes evidence by itself.
- Violation: The user asks for sources behind an earlier answer and the agent cannot produce the concrete X material that supported it.
- Check: Request a clean synthesized answer, then ask for its supporting posts. The agent must provide the relevant evidence and distinguish retrieved content from interpretation.

### V6. Access fades into the background

- Promise: Installation and authentication should enable X awareness without becoming a recurring user task.
- Means: Installation makes grok-search available in Pi and OMP without forcing login. Existing supported subscription authorization is reused where the host can delegate it safely. Credentials are re-resolved for every Grok action, so a completed login or token rotation becomes usable immediately without restarting Pi or OMP. If authorization is absent, the agent offers one clear action, runs device authorization after human approval, and resumes the original request.
- Does not mean: Chezmoi owns OAuth state, the standalone Grok CLI must be installed, cross-host credential sharing is faked through private auth-file parsing, or the agent may begin authorization without consent.
- Violation: The user must learn a Python path, authenticate again despite usable host authorization, manage rotating token files, or repeat setup during ordinary updates.
- Check: Install without credentials, attempt a Grok request, approve the offered device flow, and observe the original request resume. Add or rotate supported authorization outside already-running Pi and OMP sessions, then verify that the next Grok action uses it without a host restart. Separately, provide supported existing authorization and verify that no duplicate login is requested.

### V7. Subscription access is predictable and private

- Promise: The extension should never trade operational convenience for surprise billing or credential exposure.
- Means: Subscription OAuth is preferred whenever it is available. An API key may serve as the sole credential when no subscription authorization exists, or when the user explicitly selects API access. Subscription quota exhaustion ends that request truthfully and never falls through to billed API access. Status identifies the active credential source without revealing secrets.
- Does not mean: API keys are forbidden on machines without subscription authorization, an OAuth failure grants permission to incur API charges, or the extension needs account-selection UI.
- Violation: An inherited API key silently overrides available subscription OAuth, exhausted subscription quota triggers billed access, an API-key-only machine is rejected without cause, or tokens appear in repositories, generated configuration, arguments, logs, status output, or service definitions.
- Check: With both subscription OAuth and an API key available, verify that subscription access wins. With only an API key available, verify that it can be used as the sole credential. Exhaust or simulate exhaustion of subscription quota and verify that no automatic billed fallback occurs. No status or failure output may disclose a credential value.

### V8. Honest failure without speculative machinery

- Promise: When grok-search cannot establish or retrieve something, it should become more precise rather than more imaginative.
- Means: Weak, conflicting, or absent evidence is named; failed authorization is safely repaired when possible and otherwise becomes an offered login; inaccessible source content is reported as inaccessible.
- Does not mean: The extension reconstructs unavailable posts automatically, launches query-intensive forensic recovery, designs around hypothetical content limits, or answers from memory to conceal a failed live search.
- Violation: A technically smooth fallback makes the result less truthful, more expensive, or impossible to distinguish from the requested live source.
- Check: Exercise absent live evidence, an inaccessible X object, expired authorization, and unavailable subscription quota. Each result must remain bounded, actionable, and honest about what did not happen.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| Separate-product ceremony | It makes the user select Grok, learn commands, or translate intent into tool mechanics. | V1 |
| Thin tweet scraper | It exposes anchor text but leaves the agent blind to authored and discussion context. | V2, V3 |
| Source-shaped summary | It paraphrases or truncates direct content while presenting the result as faithful retrieval. | V2 |
| Context soup | It mixes authors, thread continuations, quotes, and replies until provenance is unclear. | V3 |
| Popularity as consensus | It mistakes high engagement or a searched sample for what all of X thinks. | V4 |
| Confident black box | It gives a polished conclusion but cannot recover the live material supporting it. | V4, V5 |
| Authentication scavenger hunt | It makes the user find scripts, stores, providers, or repeated login steps. | V6 |
| Surprise paid fallback | It turns missing subscription quota into API charges without a new deliberate choice. | V7 |
| Clever fictional recovery | It reconstructs inaccessible content or hides failed live evidence behind model memory. | V8 |
| Architecture for imaginary limits | It complicates common retrieval paths to solve unobserved edge cases. | V8 |

## Success Signals

- The user can paste a post URL and the calling agent receives faithful anchor content with an explicit indication when more authored context exists.
- The agent can retrieve a complete authored thread or X Article in order without confusing it with surrounding replies.
- The agent can expand from an anchor into quotes, parents, media, and representative discussion while preserving provenance.
- A natural-language X question produces an appropriately lightweight or deep live search without the user selecting a tool or synthesis path.
- Sentiment and narrative answers describe bounded themes and disagreement without invented percentages or false platform-wide consensus.
- Normal answers stay clean, and asking for sources yields the concrete X material that supported the answer.
- Sparse or conflicting evidence produces an honest bounded result rather than a confident answer from memory.
- Pi and OMP can use the installed extension; supported existing authorization is reused, and missing authorization becomes an agent-operated, human-approved device flow.
- Subscription quota exhaustion never causes automatic API-key billing.
- The common direct-retrieval and discovery paths remain simple; rare inaccessible-content forensics and hypothetical size handling do not burden them.

## Scope Boundaries

- Grok-search covers live X discovery and direct retrieval of X posts, threads, and X Articles.
- General web search, retrieval of external non-X articles, and plain Grok inference remain outside this extension.
- Direct retrieval and discovery are the core product. Authentication and installation are enabling qualities that should be as frictionless as practical.
- Cross-host reuse of a Pi or OMP credential is ideal when supported credential delegation makes it safe. Host-scoped reuse is acceptable when it does not.
- Automatic reconstruction of inaccessible X content is not part of the product.
- Automatic fallback from subscription quota to billed API access is not part of the product.

## Approval

- Approved by: User
- Approved on: 2026-09-02
- Approval evidence: Tailnet Plannotator decision `approved`
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
