# Wall Clock Context

Wall Clock defines enforced real-time limits for agent work and delegated assignments.

## Language

**Time contract**:
The owner session's enforced deadline, wrap-up boundary, and expiry policy.
_Avoid_: Timer, time guidance

**Owner session**:
The top-level session that owns one time contract and its full assignment tree.
_Avoid_: Main session, parent session when referring to the tree root

**Execution session**:
One host session that performs an assignment.
_Avoid_: Child when the assignment depth is important

**Assignment**:
A bounded piece of work with an objective, scope, acceptance targets, and an enforced time ceiling.
_Avoid_: Task when referring to the Wall Clock record

**Root assignment**:
An assignment created directly by the owner session under a plan item.
_Avoid_: Top-level task

**Nested assignment**:
An assignment created within another assignment and bounded by that parent assignment.
_Avoid_: Grandchild task

**Effective deadline**:
The earliest applicable deadline from the time contract, every ancestor assignment, and the assignment's own requested ceiling.
_Avoid_: Child timeout

**Expiry policy**:
The time contract's rule for either blocking new work or also aborting supported running work at expiry.
_Avoid_: Stop mode

**Terminal report**:
The structured result that ends an assignment as complete, partial, blocked, or expired.
_Avoid_: Final message
