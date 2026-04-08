# Software Factory Skills

Skills are organized into three categories (set via `category` in SKILL.md frontmatter):

## `factory` — Factory Execution Loop

Skills that the automated factory agent needs during the execution loop.
These cover tool usage, realm I/O workflow, and control flow.

- **software-factory-operations** — Tool-use workflow for searching, writing, testing, and updating tickets

## `reference` — Boxel Development Patterns

General Boxel card development knowledge. Loaded for both factory and human sessions.
The `boxel-development` skill uses a `references/` subdirectory with keyword-matched
loading to keep token usage efficient.

- **boxel-development** — Card definitions, templates, styling, queries, testing patterns
- **boxel-file-structure** — File naming, directory layout, module path conventions

## `cli` — CLI-Only Skills

Skills that require `boxel` CLI commands. Excluded from the factory agent
(which uses realm HTTP APIs instead) but available in human Claude Code sessions.

- **boxel-sync** — Bidirectional sync strategies
- **boxel-track** — Local file watching and checkpoints
- **boxel-watch** — Remote server monitoring
- **boxel-restore** — Checkpoint restoration
- **boxel-repair** — Realm metadata repair
- **boxel-setup** — CLI onboarding and profiles
