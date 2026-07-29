# Data and Schema Checklist

Look for data behavior that the base branch still requires.

Check:

- removed or renamed columns, fields, indexes, constraints, and enum values;
- nullability, defaults, uniqueness, cascade, and validation changes;
- existing migration files edited in place rather than a new migration being
  added through the project's normal generator;
- ORM or serialization changes that drop fields, change empty values to null,
  or alter numeric, date, or identifier formats;
- backfills and data scripts whose filters, ordering, batch size, retry behavior,
  or target environment changed.

Cross-check application consumers and the actual migration/model source before
calling a schema difference intentional.
