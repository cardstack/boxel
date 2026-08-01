# Authorization examples

These examples preserve useful relationship shapes learned from Boxel realm
prototypes while deliberately removing source realm URLs, organization names,
and copied identities.

Run both executable fixtures with:

```sh
npm run example:authorization
```

The coordination fixture covers:

- an inventory scanner that may record scans but cannot amend ledger entries;
- players scoped to one game instance;
- an application service that may act only on its linked application;
- a nested judging team and a separate chair role;
- `checkCapability`, `listResources`, `listParties`, and `listCapabilities` parity.

The software-release fixture covers:

- release-manager and maintainer capabilities that remain distinct;
- administrator-only approval revocation;
- contributors who can inspect changes but cannot approve or merge them;
- a security reviewer reaching Change A through a nested review team and
  Change B through a direct review team;
- refusal on Change C, whose assigned review team is different;
- membership edits changing decisions after a new snapshot is prepared.

Both use the public `bxl-authorization/1` dialect. OpenFGA syntax is not used by the
examples; it appears only in the pinned semantic-conformance tooling.
