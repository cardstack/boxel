# Railway publication identity repair

Active item: repair the service identity used by indexing and publication. The
Matrix transport hostname does not determine the homeserver identity. On the
isolated Railway stack the existing helper reduces the hostname to railway.app,
which creates an actor with no matching realm permission. Publication then parks
in a durable read-authority wait and the client rejects the pending snapshot.

Use the explicitly configured MATRIX_SERVER_NAME only for the MATRIX_URL it
belongs to. Preserve the existing behavior when no matching configuration exists,
including localhost routing and unrelated homeservers. Do not change permissions
to authorize the incorrectly constructed account or bypass publication guards.

Pass/fail commands, recorded before editing:

- `cd packages/realm-server && pnpm exec qunit tests/matrix-user-id-test.ts`
- `cd packages/runtime-common && pnpm lint`
- `cd packages/realm-server && pnpm lint`

Retain full logs under /tmp/lattice-identity-\*.log. After deployment, the queued
publication must use the real service identity and publish a ready day. Native
BXL activation and performance measurements remain separate work.

Validation: focused QUnit 5 passed, 0 failed. Both package ESLint commands pass.
Full package lint remains failing in unchanged Boxel UI dependencies: runtime
reports six type diagnostics; realm-server reports four. Neither reports a type
diagnostic in the changed files. The standard prepare-worktree-types script built
icons but its Boxel UI Rollup step failed parsing scoped CSS. Full logs are
retained; these checks are not represented as passing.
