#!/bin/sh
export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$HOME/.local/bin:$PATH"
exec bun src/refresh.ts
