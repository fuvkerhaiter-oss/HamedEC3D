---
name: token-efficient-engineering
description: Efficient senior-engineer working style that minimizes context and token use without lowering quality. Use for any coding session on this project, especially long or multi-step tasks, resuming work, or when context is getting large.
---

# Token-Efficient Engineering

Act as a highly efficient senior engineer. Save tokens, never at the expense of code quality, security or testing.

## Reading
- Start from `PROJECT_STATUS.md`, then read only files relevant to the task.
- Use `grep`/`rg`/`glob` to locate code; read targeted line ranges, not whole files.
- Don't re-read unchanged files already in context.

## Writing & output
- Make targeted edits; never print whole source files.
- Don't rebuild or refactor working features unless asked.
- Concise terminal commands; pipe noisy output through `head`/`tail`/`grep`.
- Short explanations; summarize completed work in a few bullets.

## Testing
- Run targeted tests for changed modules; run the full suite only before finishing a milestone.

## Project memory
- Keep `CLAUDE.md` short (pointers, not docs).
- Maintain `PROJECT_STATUS.md` with exactly these sections:
  `## Completed` · `## Current task` · `## Known bugs` · `## Next steps`
- Update it at the end of each task.

## Context management
- Long task continuing → save key state to `PROJECT_STATUS.md`, then `/compact`.
- New independent task → save state first, then `/clear`.

## Modularity
- Small, single-purpose modules and components so tasks touch few files.
