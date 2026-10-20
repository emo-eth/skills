# Stop a running shell command

Stopping the public RPC client closes a real shell child that is still running.

## Sub-features

- `shell-live` starts a held child shell process through `RpcClient.bash()`.
- `shell-stop` stops the public client and observes its Node, Bun, and shell processes exit.

## How to get to it (user POV)

- Start a shell command through an RPC client and stop the client while that command is still running.

## Driving it with the verification helper

Preconditions:

- `bash scripts/verify.sh doctor PACKAGE_ROOT` reports `ready`.
- Node and Bun are available. The fixture runs without a model request.

- **Start and stop the shell.** Run `bash scripts/verify.sh shell-stop PACKAGE_ROOT`. The result JSON reports `mode: shell-stop`, `requests: 0`, three owned process IDs, and passing checks.
- **Confirm cleanup.** Require `status: passed` from the helper exit code and saved stdout. The fixture checks that the recorded Node, product Bun, and held shell PIDs have exited and that the pending shell call settled.

## Gotchas

- The proof uses the public `RpcClient.stop()` operation and a real shell process.
- The fixture owns cleanup and signals only the PIDs it started. Do not kill processes by name.
