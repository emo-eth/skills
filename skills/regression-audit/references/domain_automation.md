# Automation and CI Checklist

Look for automation that stopped running, stopped failing, or started targeting
the wrong thing.

Check:

- workflow triggers, branch filters, job dependencies, permissions, and matrix
  coverage;
- removed `set -e`, `pipefail`, traps, exit-code propagation, or failure gates;
- scripts that changed input filters, payload shapes, output paths, or deploy
  targets;
- artifact publishing, cache keys, generated-file steps, and release ordering;
- newly swallowed errors such as `|| true`, broad exception handling, or hidden
  stderr that operators relied on.

Verify the downstream job, consumer, or deployment before reporting a change.
