# BXL Clinical Access

A small hospital-access realm that demonstrates the synchronous BXL
Authorization runtime against linked realm data.

Open the workspace card, choose a patient record, then use **View as a person**.
Sections and command buttons are projected from live capability decisions. Use
the break-glass control while viewing as the emergency physician to exercise an
input-dependent rule.

The detailed graph, decision flow, access matrix, and policy excerpts are in
[SCENARIO.md](./SCENARIO.md).

Review the mutation endpoint, target-first indexing policy, monorepo delta,
and all ten reversible demonstrations in
[reviewers-guide.md](./reviewers-guide.md).

## Files

- `workspace.gts` — the default workspace and entry point
- `principal.gts` — people and recursively nested teams
- `clinical-access-policy.gts` — editable BXL statements and policy membership
- `facility.gts` — parent resource used by `via(...)`
- `patient-dashboard.gts` — hospital fields, BXL computed fields, authorization
  snapshot, projection, and dashboard UI
- `bxl/` — the realm-local BXL runtime build

All names and records are synthetic.
