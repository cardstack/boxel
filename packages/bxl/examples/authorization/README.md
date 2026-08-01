# Authorization examples

These examples preserve useful relationship shapes learned from Boxel realm
prototypes while deliberately removing source realm URLs, organization names,
and copied identities.

Run both executable fixtures with:

```sh
npm run example:authorization
```

The coordination fixture covers:

- a device that may record an attendance event but cannot amend records;
- players scoped to one game instance;
- an application service that may act only on its linked application;
- a nested judging team and a separate chair role;
- `authorize`, `listCards`, `listParties`, and `listCapabilities` parity.

The education-report fixture covers:

- administrator access to notes but not internal notes;
- lead teacher and instructor access to both note classes;
- general staff access to room and attendance information only;
- a service provider reaching Student A through a nested provider group and
  Student B through a direct provider group;
- refusal on Student C, whose provider group is different;
- membership edits changing decisions after a new snapshot is prepared.

Both use the public `boxel-policy/2` dialect. OpenFGA syntax is not used by the
examples; it appears only in the pinned semantic-conformance tooling.
