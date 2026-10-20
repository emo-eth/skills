---
name: verify-tardigrade-pi
description: "Verify Tardigrade Pi through its public RPC client and real terminal processes. Use when asked to verify, smoke-test, or check the Tardigrade Pi port."
disable-model-invocation: true
---

# Verify Tardigrade Pi

Use this skill only when the user asks for a Tardigrade Pi verification. The source package is `packages/tardigrade-pi` in the `tau-tardigrade` checkout. Ask for the checkout path only if it cannot be found from the active repository or the user has not named a checkout.

## Check the instance

Run the doctor before each fresh verification run:

```sh
bash scripts/verify.sh doctor /path/to/tau-tardigrade/packages/tardigrade-pi
```

The doctor reports the package version, Git revision and dirty state, Bun and Node versions, required RPC binaries, fixture files, and a source-to-build timestamp check. It requires Bun 1.4.2. The timestamp check is a warning signal, not proof that build output matches source. If it reports stale output, run `bun run build` once in the package. Do not rebuild again unless source changes.

## Run proofs

Run the complete public-client workflow, then the shell-stop workflow:

```sh
bash scripts/verify.sh full /path/to/tau-tardigrade/packages/tardigrade-pi
bash scripts/verify.sh shell-stop /path/to/tau-tardigrade/packages/tardigrade-pi
```

Each run calls the doctor and saves its output in a timestamped evidence directory under `${XDG_STATE_HOME:-$HOME/.local/state}/tardigrade-pi-verification/`. Pass a third argument to choose another evidence directory. The helper saves the exact command, stdout, stderr, exit code, Git state, and SHA-256 hashes for package, source, binary, and built files. The full fixture's `proof.json`, `requests.json`, and tool effect log are copied into the evidence directory. Its temporary fixture directory stays inside that directory. Keep all evidence after the processes stop.

The fixtures use the published `RpcClient`, launch the actual Node RPC entry and product Bun process, and route model requests to a local stub. They do not contact a paid model provider. The full workflow checks a conversation, a real tool write, saved history, a fresh-process reopen, and a continuation. The shell-stop workflow holds a real child shell process and checks that `RpcClient.stop()` closes the owned Node, Bun, and shell processes without a model request.

The fixture code owns process cleanup and records exact PIDs. It stops the client, waits for child processes to exit, and signals only PIDs that the fixture started. Its temporary files remain in the evidence directory. Do not stop other processes or remove evidence. If a run fails, keep its failure record and doctor again before retrying.

## Report limits

Report the package revision, dirty state, each command's exit code, evidence directory, and fixture result. Do not infer parity from these RPC runs. The TUI visual experience, installed or clean-package behavior, platform coverage, and broad plugin coverage are unverified here. The existing 149-row surface inventory remains the completion authority. The reopen run verifies saved-history recovery and continuation after normal completion; it does not verify crash recovery.

## Maintain the map

When package behavior or entry points change, compare these feature notes with source and update only this skill directory. Keep each claim tied to a real user route and observable result. Do not expand this map into a second copy of the acceptance inventory.

This recipe follows the [upstream verification-skill workflow](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
