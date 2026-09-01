# BXL clinical `_mutate` spike

This branch uses only synthetic medical data cloned from the BXL Clinical
Access realm in `~/boxel-workspaces`. Tessar data is not part of the sample,
mount, documentation, or intended commit.

## Realm

- Local files: `packages/bxl-clinical-mutation-realm`
- Local URL: `https://localhost:4251/bxl-clinical-mutation/`
- Entry card: `ClinicalMutationWorkbench/main`
- Target record: `PatientDashboard/pt-1001`

All patients, clinicians, facilities, identifiers, notes, and events are
synthetic.

## Interactive scenario

The workbench is a wide two-column card. The left column describes and runs a
BXL command; the right column embeds the target patient card in isolated
format and scrolls independently.

Apply performs one surgical mixed-shape change:

- updates contained systolic blood pressure and heart rate;
- replaces the linked attending clinician;
- appends a contained clinical note; and
- appends a contained audit event.

Reset runs an explicit inverse BXL program that restores baseline vitals and
attending, then removes the synthetic note and audit event.

## Endpoint contract

`POST /_mutate` treats BXL as DML over persisted JSON source. It is not an
optimistic Card API edit, so its Matrix invalidation is returned to the
initiating client. A future Card API mutation may supply a client request ID
to suppress the echo after applying an optimistic local update.

The target file is indexed first at interactive priority. Recursive dependent
invalidation is queued separately as background work.

## CLI helper

```sh
mise exec -- node packages/realm-server/scripts/clinical-mutate.ts \
  /PatientDashboard/pt-1001 \
  '.vitals.heartRate = 112;' \
  --syntax solidified
```

## Human acceptance criterion

From clicking Apply or Reset, the embedded target must visibly show the new
indexed value within 10 seconds. A fast HTTP response or source-file write is
not sufficient by itself.
