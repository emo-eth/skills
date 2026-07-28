# Shared Code and Generated Output Checklist

Look for silent behavior loss when shared code, public APIs, or generated output
changes.

Check:

- exported functions, types, fields, and error values removed or narrowed;
- local implementations replaced by shared helpers without comparing edge-case
  behavior such as nil, empty strings, retries, ordering, and time zones;
- generated clients, schemas, bindings, or types edited by hand without the
  source-side change or generator command;
- code-generation configuration, version pins, and generated output drifting
  apart;
- all consumers of a changed shared API, not only the consumer in the diff.

Name at least one affected consumer for a high-confidence finding. If no
consumer remains, downgrade the finding or clear it as intentional.
