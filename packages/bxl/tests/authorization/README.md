# Authorization kernel tests

This tree drives the BXL-native synchronous authorization kernel against a
pinned OpenFGA semantic-conformance corpus.

The compatibility claim is semantic, not syntactic. Application authors use
the `boxel-policy/2` Card · Party · Seat · Capability dialect and ordinary BXL
predicates. The compiler lowers it to the private `bxl-authorization/1` graph
IR. OpenFGA DSL and CEL appear only in upstream fixtures and test-only
conversion tooling.

## Zero-skip rule

The pinned YAML corpus contains 1,227 unique assertions:

- 491 Check assertions;
- 348 ListObjects assertions;
- 388 ListUsers assertions.

`npm run test:authorization:conformance` must exit non-zero while any assertion
is unsupported, cannot be imported, returns the wrong result, or produces the
wrong error classification. Unsupported work is never treated as a skip.

The conformance runner is green only when all 1,227 assertions pass. Its
summary separately reports incorrect results, importer failures, and
unsupported cases; each category makes the command exit non-zero.

Run fixture integrity checks independently with:

```sh
npm run fixtures:authorization:verify
```

Run the complete semantic gate with:

```sh
npm run test:authorization:conformance
```

The OpenFGA transformer and YAML parser are development-only test tooling.
The public production entry point is `prepareBoxelPolicySafe`. The low-level
`bxl-authorization/1` entry remains available for compatibility and kernel
testing, but is not the Boxel authoring surface.

Run the Boxel-native Realm Collaboration command-capability, target-isolation,
nested-team, and enumeration tests with:

```sh
node scripts/run-ts-entry.mjs tests/unit/boxel-policy-cli.ts
```

The checked-in fixture is generalized: it preserves coordination behaviors
without source realm URLs, organization names, or copied identities.

Run the generalized education-report backport with:

```sh
node scripts/run-ts-entry.mjs tests/unit/education-policy-cli.ts
```

It executes 40 decisions and 10 capability-list expectations across
administrator, instructional, assigned-provider, unassigned-provider, and
general-staff boundaries. It also proves nested userset traversal remains
student-scoped and that re-preparing after a membership edit changes access.

Run the broad, non-SLO performance regression gate with:

```sh
npm run test:authorization:performance
```

Use `npm run bench:authorization` for descriptive numbers. The regression gate
has deliberately generous budgets for shared CI; it detects algorithmic
blow-ups rather than promising production latency.

For the yes/no capability boundary, API walkthrough, host responsibilities,
and Realm Collaboration examples, see
[`docs/authorization.md`](../../docs/authorization.md).
The runtime architecture and OpenFGA/Zanzibar citations are in
[`src/authorization/README.md`](../../src/authorization/README.md).
