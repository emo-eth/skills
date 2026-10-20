# RPC conversation and tool work

An RPC client can send a prompt, receive a response, run a file tool, and read the saved result through the same public interface a client uses.

## Sub-features

- `rpc-prompt` starts and completes a prompt through `RpcClient`.
- `rpc-tool` performs one real file write and returns its result.
- `rpc-state` exposes the saved messages and final assistant text.

## How to get to it (user POV)

- Connect an application through the published `RpcClient` and send a prompt.
- Let a model tool call write a file, then inspect the conversation and project.

## Driving it with the verification helper

Preconditions:

- `bash scripts/verify.sh doctor PACKAGE_ROOT` reports `ready`.
- The package source and build match. The fixture sends requests only to its local model stub.

- **Drive the public client.** Run `bash scripts/verify.sh full PACKAGE_ROOT`. The successful JSON result reports `mode: full`, seven local provider requests, passing checks, and an evidence path.
- **Confirm the tool effect.** Read `stdout.txt` for the fixture's successful result. The run checks that the real RPC path wrote one file with the requested contents and saved the tool result in public history.

## Gotchas

- This exercises RPC. It does not prove TUI behavior.
- Do not replace the local stub with live provider credentials. This fixture is deterministic and makes no paid-provider request.
