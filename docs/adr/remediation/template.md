# ADR NNN remediation

Places where the code does not meet [ADR NNN](../NNN-slug.md) yet (ADR 001
§1.6). Each entry names a file by its path from the repository root, in
backticks, and the requirement it breaks. Write "No known gaps." when there are
none.

- `packages/example/old-path.ts` (`legacyLoad`) breaks §1.1.

Entries about one file can share a line that names it:

`packages/example/loader.ts`:

- `fetchModule` breaks §1.2.
- `load` breaks §1.3.
