# Boxel implementation plans

These documents record sequencing and review boundaries. They are not protocol
contracts and are intentionally not featured on the main documentation page.

- [A0–A6 reviewer guide](./deck-a0-a6-reviewers-guide.md) — the exact local
  stacked-PR order, checkpoints, load-bearing files, and independent gates for
  the completed package/runtime substrate.
- [PretUI-first collaboration backport](./deck-pretui-collaboration-backport.md)
  — the remaining B0–B8 plan, with Boxel CLI as the primary Claude Code client,
  S3 Files infrastructure, and deterministic PretUI syndication back into the
  Boxel monorepo.
- [B0 reviewer guide](./deck-b0-reviewers-guide.md) — the feature-gated realm
  adapter that verifies Repository, branch, Checkpoint, Review, merge, and
  exact Version origin state before later CLI and Host slices consume it.
- [B1a reviewer guide](./deck-b1a-reviewers-guide.md) — realm-local and
  direct-S3 conditional object adapters, writer-owned preparation, and
  recovery semantics; AWS provisioning remains the following B1b slice.
