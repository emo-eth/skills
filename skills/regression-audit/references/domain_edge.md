# Edge and Network Checklist

Look for routing, filtering, caching, and proxy behavior that changed at the
edge.

Check:

- DNS records, hostnames, origins, redirects, and route bindings;
- WAF, firewall, country or identity filters, and allow/deny scope;
- cache eligibility, cache keys, TTLs, invalidation, and auth-sensitive paths;
- proxy headers, request rewriting, response filtering, and privacy controls;
- edge worker or gateway routes that were removed or pointed at a new origin.

Treat weakened access controls, privacy filters, or auth-sensitive caching as
High severity. Prove the affected route or origin from the base configuration
and its consumers.
