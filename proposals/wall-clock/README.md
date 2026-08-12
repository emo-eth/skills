# Wall Clock Plugin

## Glossary

- **Wall clock**: Real elapsed time measured against a deadline or duration.
- **Main session**: The session that owns the overall plan.
- **Child session**: A session working on an assignment from a main session.
- **Assignment**: A bounded part of the main plan given to a child session.
- **Budget**: The maximum time available to a session or assignment. It is not a work quota.
- **Wrap-up**: The period when the agent stops starting risky or new work and prepares a report.
- **Hard expiry**: The point after which the plugin blocks new tool calls.
- **Host enforcement**: A runtime action that can block or stop work, not an instruction to the model.

This directory contains the design and research for the experimental wall-clock plugin. The implementation lives separately in `plugins/wall-clock/`.

Nothing in this directory is discovered by `npx skills`: only directories under `skills/` are skill candidates in this repository.

## Documents

- [Research report](research-report.md)
- [Design](design.md)
- [Future work](future-work.md)
- [Review answers](review-answers.md)
- [Decisions](../../docs/DECISIONS.md)
