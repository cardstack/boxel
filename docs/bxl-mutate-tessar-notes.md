# Tessar `_mutate` design notes

Living notes from sending Mutation BXL at the extracted
`sample-screens-chris-tessar-admin` realm. The language guide stays the
candidate spec; this file records what the HTTP endpoint actually did.

## Realm

- Source zip: `sample-screens-chris-tessar-admin.zip`
- Local mount: `packages/screens-realm` → `https://localhost:4251/tessar-admin/`
  (4201 is occupied by an obscura staging proxy on this machine)
- Production counterpart: `https://app.boxel.ai/chris/tessar-admin/`

## Endpoint

```
POST {realm}/_mutate
Accept: application/vnd.card+json
Authorization: Bearer <realm JWT>
```

```json
{
  "href": "/Staff/ms-green",
  "source": "Name = \"Ms. Greene\";",
  "syntax": "readable"
}
```

Helper: `mise exec -- node packages/realm-server/scripts/tessar-mutate.ts <href> <source>`

## First programs to try

These map to the card-operations examples (no operations layer — just
the mutate base).

| Intent                       | Target                                          | Readable BXL                                | Why this card                                                                              |
| ---------------------------- | ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Rename a staff member        | `/Staff/ms-green`                               | `Name = "Ms. Greene";`                      | stored scalar, not computed                                                                |
| Move a student               | `/Student/0178fe21-399a-49f3-adb4-9ab0ede8bfbd` | `Location = "At Specialists";`              | Jamie Chen; `location` is stored. `firstName` is computed from `fullProfile` and must skip |
| Rename a classroom           | `/Classroom/classroom-2a`                       | `Classroom Name = "Classroom 2A — Lab";`    | `classroomName` is stored                                                                  |
| Assign a teacher             | `/Classroom/classroom-2a`                       | `Teacher = card("…/Staff/ms-rivers");`      | `linksTo(Staff)`                                                                           |
| Add a student to a classroom | `/Classroom/classroom-2a`                       | `append(Students, card("…/Student/<id>"));` | `linksToMany(Student)`                                                                     |

Solidified equivalents use jq paths (`.name`, `.location`, `.classroomName`,
`.teacher`, `.students`).

## Observations

- `Name = "Ms. Greene";` against `/Staff/ms-green` returned `200`. The
  response contained the indexed card with `name: "Ms. Greene"`, and the
  change was written to the Tessar source file.
- `Location = "At Specialists";` against Jamie Chen's Student card and
  `Classroom Name = "Classroom 2A — Lab";` against Classroom 2A were both
  written to their source files and appeared in the indexed cards.
- A leading-slash href must be resolved relative to the realm path. Ordinary
  URL resolution would turn `/Staff/ms-green` into
  `https://localhost:4251/Staff/ms-green`, escaping `/tessar-admin/`.
- The first request after restarting the realm took about 23 seconds. A later
  request waited about 117 seconds while the realm completed its initial
  index before processing the incremental update. The endpoint deliberately
  keeps the request open until it can return the newly indexed card.
- The endpoint returns the primary indexed card without expanding linked or
  query-backed cards. Direct relationship identifiers remain in the response;
  this keeps a mutation from failing because an unrelated linked card cannot
  be loaded.
- Run the TypeScript helper through the repository's pinned toolchain (`mise
exec -- node ...`). The helper accepts the documented positional arguments
  both with and without `--syntax`.
- The shared local database used by the Tessar service has a newer
  `realm_view` uniqueness column, while the branch's test database does not.
  The local compatibility edits were removed from this prototype: aligning or
  migrating that shared database is separate from the `_mutate` endpoint.
- The focused endpoint suite passes all four cases. Its setup still logs
  retries for the unavailable `https://cardstack.com/base/card-api`; those
  retries are pre-existing fixture noise and did not fail the suite.
