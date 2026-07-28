# Application Behavior Checklist

Look for behavior that existed on the base branch and was silently removed or
narrowed in application code.

Check:

- routes, handlers, commands, and service entry points for removed branches,
  authorization checks, validation, retries, or side effects;
- API request and response fields, event payloads, and user-visible states for
  dropped or renamed data;
- error handling, logging, metrics, and analytics that consumers or operators
  still rely on;
- refactors that preserve the function name but change filtering, ordering,
  pagination, null handling, time zones, idempotency, or transaction scope;
- imports replaced by shared helpers or types whose behavior is narrower than
  the old local implementation.

For every finding, name a current caller or consumer when possible. Do not flag
new bugs introduced by the branch; `preflight-bugbash` owns those.
