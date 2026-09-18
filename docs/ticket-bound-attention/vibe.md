---
date: 2026-09-18
topic: ticket-bound-attention
status: approved
source_material: 2026-09-18 user dump in the standup/command-center pane, plus grilled choices. Independent rewrite 2026-09-18 to restore vibe quality (feel contract, not a procedure). Amended 2026-09-18: shelving must not destroy in-flight sessions. Amended 2026-09-18: use command center for that workspace; do not invent a second name.
---

# Ticket-Bound Attention Vibe

## Glossary

Definitions here describe. They do not prescribe a mechanism.

- **Desk**: what is currently open in Herdr. The visible working set. Not the filing cabinet.
- **Archive**: Linear. The place an idea lives so it cannot be forgotten when it leaves the screen.
- **Ticket**: a Linear issue that holds the intention, the vibe, and the done-when for one piece of work, plus enough of a map that the rest can be found.
- **Worktree**: an isolated checkout opened to do that work. A place you can sit.
- **Chair**: one Herdr workspace currently showing.
- **Parked**: still open in the archive, not on the desk. Hidden, not destroyed. In-flight sittings come back, or their progress already lives with the tree.
- **Done-when**: the ticket's own accepted criteria. The only permission for a funeral.

## Vibe Promise

Herdr is the desk, not the memory. Looking at it should feel like looking at now. Every idea that might need to be remembered is already captured, so a clean desk cannot mean forgetting. Low priority is a real outcome, not a reason to keep a chair. Hiding work should feel safe, including work that was mid-thought: the sitting continues when the chair comes back, or its progress already lives with the tree. Deleting work should feel like a funeral, and only finished work gets one. Picking a ticket up later should feel like recognizing a face, not reading a diary or hunting a spec. The desk is chosen with you, not to you. Thinking and asking do not require ceremony. Projects do.

## Ideal Reality Dump

- "I want to try where every Herder work tree has a Linear ticket associated with it"
- "when we are driving work from this repo, only the things we are actively working on are currently open in Herder workspaces"
- "Once a ticket is fully closed we can delete the workspace. Put differently we can only delete the workspace when the ticket is fully closed."
- "Tickets should capture the intention, the vibe, and the accepted criteria for what we're trying to accomplish in the work tree."
- "Depending on how tickets are prioritized, the agent should close or open work trees in Herder."
- "I only want to see the stuff in Herder that we're currently working on but I don't want anything that I don't see in Herder to be lost."
- "I want a clean workspace but I want to make sure that every idea I have, every workspace I open with an idea, is tracked."
- "If it's just 'oh I want to ask a question,' then sure: the ticket gets made, the question is answered, the ticket is closed, and the workspace is gone."
- "This will help me not get distracted because right now I have a million things open and that's because I'm afraid I'm going to forget and I don't want to forget."
- "That's why I guess the Linear backend is important, because if there's a ticket for everything, we can prioritize tickets. Maybe something's really low priority and that's fine."
- "We should use our reranking thing to rank the priorities of tickets."
- "opening a worktree should have a hook that creates a linear ticket."
- "agents should know what ticket is associated with the worktree and have standing instructions to update the linear ticket with spec/details as it progresses. not too much, not too little."
- "a scratch space is nice. rn we're using the scratch space as the driver so idk maybe just panes i open in there"
- "Not visible, not deleted"
- "opening a tree names it and creates it this sitting. the driver may check in to make sure it's actually a priority and nudge to shelve it if not. no shelve without (rough?) priority"
- "only if it wasn't actually done"
- "ticket everything, make sure priorities are aligned, then shrink desk"
- "if a worktree has dirty files, done-when is not met"
- "ticket-only until seated along with some ability/prompt to prune"
- "only as many of the important tasks as can be done in parallel. 3 tasks with constant back and forth - no more seats. when agents are fully saturated and working - can add more seats"
- "rename the worktrees to something human-intelligible... ticket numbers are useless to me"
- "shelving a workspace shouldn't be destructive - if there are sessions with pending progress it should either be resumed on re-open or persisted/snapshot in the worktree"

## Use Circumstances

- Overwhelmed morning: dozens of workspaces are open because yesterday's ideas felt too expensive to close. The desk should be able to become small without any of those ideas dying.
- A question pops up mid-flow: "just asking." Capture it, answer it, let the extra chair vanish. The command center can hold the conversation without becoming a second project.
- A low-priority idea is real and must not vanish. It is captured, it may sit briefly, then it leaves the desk and is still findable.
- Ranking changes this sitting. Newly now work can be sat in. Work that is not now leaves the screen and is not destroyed, including an agent that was mid-thought: re-opening should feel like walking back into the same sitting, or the progress should already be in the tree.
- An agent is already in a seated tree. It knows the ticket. A later agent can pick the same work up cold.
- The user is afraid of forgetting. Closing or hiding a workspace must feel safe because the archive still holds the idea.

## Vibe Clauses

### V1. Capture is the default, not the extra step

- Promise: Every worktree is born with a ticket. Every idea that might need to be remembered becomes a ticket even if it never sits and even if it never gets a tree. Capture is cheap. Keeping forever is not: junk can be offered for prune, separately from "real, not now." Forgetting because something left Herdr is a system failure, not a user failure.
- Example: (Example only, not a formula.) Opening a tree creates or binds a ticket before anyone starts working. A thought in the command center that might matter later is captured in the same sitting, with no checkout required. Ranking later may create a place to sit when that ticket becomes now. Prune asks; it does not silently destroy.
- Does not mean: Every keystroke needs a ticket, or that thinking requires a form. Nested tickets may exist in the archive; they do not each become a tree.
- Violation: A worktree with no ticket. An idea that lived only as an open workspace and vanished when the desk was cleaned. A remember-later thought with no ticket because no tree was opened. Tickets destroyed as "prune" without asking.
- Check: Pick any open worktree and name its ticket. Pick a command-center thought that needed to be remembered and find it in Linear with no tree. Hide a workspace whose ticket is still open and still find the intention without Herdr.

### V2. The desk is now, and now is small

- Promise: Looking at Herdr should feel like looking at what can actually be worked right now. The steady desk is ranked now, plus what the user named this sitting, plus a few standing chairs that still serve. Size is parallel attention, not pile size: a few back-and-forth tasks fill the seats; saturated working agents may take more. Opening a tree is sitting down this sitting; staying seated is earned. Nothing is shelved until it can be found later. Low priority is a valid, first-class outcome. Chairs are named for the work, so the desk is readable.
- Example: (Example only, not a formula.) Three operator-coupled tasks are already bouncing. A fourth important ticket stays parked even if it is in the named pile. Overnight, seated agents are saturated and working, so another seat may be added. The user opens a tree to dump a thought; it appears; once it has a rough place in the pile, it can leave. A standing chair is one you can name and retire. Nested subs do not each open a workspace.
- Does not mean: The product may refuse a workspace the user just named, or that the desk cannot briefly grow this sitting. The command center still exists. Standing chairs are not a junk drawer of untracked work.
- Violation: A million open workspaces used as a memory prosthesis. A low-priority ticket occupying a chair "so we don't forget." Hiding work that cannot be found later. Seating more operator-coupled work than can run in parallel. Naming chairs after ticket numbers. Opening a chair per nested ticket so the desk becomes the issue graph.
- Check: After a sitting, the user can say why each visible chair is there and that they are not fighting each other for attention. Hidden open work is still findable. Standing chairs can be listed. Nested tickets under a seated parent do not appear as extra chairs.

### V3. Hidden is not gone

- Promise: When work leaves now, it leaves the desk and is not deleted. The ticket stays open. The checkout stays. In-flight sessions with pending progress are not destroyed: they resume when the chair comes back, or their progress already lives with the tree. The work can be sat in again later without reconstruction from memory. Hiding must feel safe, or the desk will fill up again.
- Example: (Example only, not a formula.) A billing tree is real work but not this week's now. It disappears from Herdr. Linear still has the intention and done-when. The checkout is still there. An agent that was mid-edit either continues when the chair is seated again, or a snapshot of that sitting is already in the tree. Next ranking can bring it back.
- Does not mean: Uncommitted work may be discarded because it left the screen, or that "not visible" is permission to destroy the tree. It also does not mean pasting the agent transcript into Linear, or requiring the user to manually save before a chair can leave.
- Violation: Deleting a workspace, checkout, or branch because it was deprioritized. Killing an in-flight session on shelf with no resume and no progress left in the tree. Leaving the chair open because hiding it would lose the thread.
- Check: Deprioritize work with dirty files and an agent mid-thought. Confirm it is absent from Herdr, present in Linear, reopenable from the existing tree without loss, and that the pending sitting either resumes or is already in the tree.

### V4. Only Done gets a funeral

- Promise: A chair and its checkout may be destroyed only when the ticket's own done-when is actually met. Leftovers mean it is not met. Closing unfinished work to tidy the desk is a lie. Closing work that is actually done should not become a ritual: ask when done-ness or done-correctness is in doubt; after trust is earned, finished work can close quietly. Until Done, the strongest allowed action is to take the work off the desk.
- Example: (Example only, not a formula.) A status question is answered, the tree is clean, the done-when is met: extra chair and checkout gone, history still in git. Uncommitted real work blocks the funeral until it is kept. Noise blocks it until the tree is cleaned. A doubtful close is asked. A clearly-done close is not blocked merely because the work was important. Early on, even a clear close may still be checked, until closing finished work feels trustworthy.
- Does not mean: Stale, annoying, or crowding work may be closed to make the desk small. Stale is a ranking problem, not a Done problem. High priority is not itself a reason to keep asking after the work is actually done.
- Violation: Deleting a workspace or checkout for an open ticket. Closing a ticket to justify cleaning Herdr. Destroying leftovers with the chair. Leaving a finished extra workspace around "just in case." Closing when the done-when is unmet or still in doubt, without asking.
- Check: Refuse to delete a chair whose ticket is still open. Refuse to delete a dirty checkout that claims Done. Close a clean, clearly-done question: the extra chair and checkout are gone, the history remains, and a doubtful close was asked.

### V5. The ticket is a face, not a diary

- Promise: An agent in a tree already knows its ticket. A later agent can pick the work up cold in about thirty seconds: what this is, how it should feel, when it is done, and where the rest lives. The ticket stays current on those things, plus the rare decision a future sitting would need. It does not accumulate process noise, and it does not become a second copy of the repo.
- Example: (Example only, not a formula.) The ticket says what this is, when it is done, and that the PRD lives with the work. The PRD body stays in git. When the done-when changes, or a product default is decided, or the work is blocked, the ticket is updated. Session chatter, tool dumps, commit-by-commit narration, and pasted spec bodies stay out.
- Does not mean: The ticket is a blank stub, or that it must contain the full spec and transcript.
- Violation: A ticket that is only a title. A ticket that is a paste of the session. A ticket that pastes the whole PRD so Linear is a second filing cabinet. An agent that does not know its ticket, cannot say when it is done, or has to hunt for the rest because the ticket had no face.
- Check: Open a mid-flight ticket cold. A new agent can state the intention, the vibe, the done-when, where the artifacts are, and whether it is seated or parked, without reading the Herdr pane and without reconstructing the PRD from Linear prose.

### V6. Scratch is the command center, not a loophole

- Promise: The command center may hold extra panes used to drive, ask, or glance. Those panes are not each a project and do not each demand a chair. A question that will die this sitting can live there with a ticket. A question that might outlive the pane gets its own tree. The moment work becomes its own tree, capture and the rest of this vibe apply. The ticket is not optional either way.
- Example: (Example only, not a formula.) Dispatching from scratch, or asking a status question that will be done before the sitting ends, stays here. "What if we did X" that might need to be found next week gets a tree. The choice is whether the work will outlive the pane, not ceremony.
- Does not mean: Scratch may quietly accumulate untracked projects, or that a remember-later question may live only as an unmarked pane.
- Violation: Using scratch as a junk drawer of untracked projects. Forcing every scratch pane through a full tree-and-ticket ceremony. Letting a remember-later question live only in a pane with no ticket.
- Check: Scratch exists as one command center. Every other workspace names a ticket. Ideas that outgrew a pane have trees and tickets. A command-center-only question that needed to be remembered has a ticket even though it never had a chair.

### V7. The desk is chosen with you, not to you

- Promise: Unranked work gets a ranking conversation. Ranked order is generally trusted, then confirmed. When stated priorities change, the work that might have moved is offered for another look. Ranking does not invent a desk in secret.
- Example: (Example only, not a formula.) Pairwise questions for unranked tickets (the existing top-k sieve is one shape). After a named pile, that order is trusted, the active chairs are confirmed, and a later change of pile prompts a rerank of the tickets that might have moved.
- Does not mean: The whole archive must be totally ordered, or that nothing may be proposed as "this looks like it moved."
- Violation: A desk seated from an agent-invented order with no ranking conversation and no confirmation. Existing ranks thrown away every sitting. A stated-priority change that never offers another look. Forcing a full re-sift of the pile to move one ticket.
- Check: After a sitting, every seated ticket is ranked, named this sitting, or a standing chair. An unranked ticket was asked about, not silently placed. A changed named pile produced a rerank prompt for the tickets that might have moved.

## Anti-Vibes

| Anti-vibe | Why it violates the contract | Clause |
| --- | --- | --- |
| The Memory Prosthesis | Keeping everything open so nothing is forgotten turns the desk into the archive and destroys attention. | V2, V3 |
| The Quiet Deletion | Removing work because it left the screen loses the very thing the archive was supposed to hold. | V3, V4 |
| The Amnesiac Shelf | Shelving kills in-flight sessions, so hiding the chair loses the thread. | V3 |
| The Cleanup Close | Marking a ticket Done to justify cleaning the desk, when the done-when is not actually met. | V4 |
| The Ritual Close | Asking forever to close important work that is actually done, just because it was important. | V4 |
| The Orphan Tree | A workspace or tree with no ticket, so hiding it is amnesia. | V1 |
| The Session Dump | Updating Linear with every turn until the ticket is unreadable as a face. | V5 |
| The Blank Stub | A ticket that exists only to satisfy capture, with no intention, vibe, or done-when. | V5 |
| The Second Filing Cabinet | Pasting the whole spec into Linear so the ticket is a duplicate of the repo. | V5 |
| The Silent Sort | Seating the desk from an invented order, without a ranking conversation. | V7 |
| The Junk Scratch | Treating scratch as permission to run untracked projects forever. | V6 |
| The Numbered Chair | Naming the workspace after a ticket id, so the desk is unreadable. | V2 |
| The Issue-Graph Desk | Opening a chair per nested ticket, so the desk becomes Linear's tree instead of now. | V1, V2 |

## Approval

- Approved by: user
- Approved on: 2026-09-18
- Amendment rule: This vibe changes only by explicit user request or direct user edit.
- Amendments: 2026-09-18 — shelving is non-destructive of in-flight sessions (resume on re-open, or progress already in the worktree). 2026-09-18 — use command center for the scratch/standup workspace; do not invent a second name.
