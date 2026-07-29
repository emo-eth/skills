# Infrastructure Checklist

Look for deployment and runtime behavior that was lost or retargeted.

Check:

- environment variables, secret names, regions, projects, accounts, service
  names, and other deployment targets;
- health, readiness, startup, timeout, concurrency, autoscaling, and resource
  settings;
- network, storage, IAM, identity, firewall, and service-to-service bindings;
- container commands, build arguments, artifact paths, and runtime entrypoints;
- configuration changes described as cleanup that actually alter production
  behavior.

Confirm the affected service and environment from consumers or deployment
references. Treat a target change as High severity when it can deploy to the
wrong environment or weaken access control.
