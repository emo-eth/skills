# Papercuts

Small frictions agents hit while working in this repository. These are not full bug reports; they are sandpaper notes for later cleanup.

## Entries

- **2026-07-30T22:00:43.122Z** `gpt-5.6-luna`
  - cwd: `.`
  - note: While checking OMP agent frontmatter, the task-agent docs linked implementation source paths that are not addressable through omp://, so the direct read failed; the index should distinguish source links from readable documentation resources.
