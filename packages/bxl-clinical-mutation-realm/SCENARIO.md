# BXL Clinical Access — scenario

This realm is a compact, non-production showcase of BXL Authorization. It uses
synthetic hospital data adapted from BXL's hospital fixtures. No real patient or
staff data is present.

## The question

For the currently selected person and patient record:

> Which dashboard sections may exist, and which clinical commands may be offered?

BXL answers yes or no for each capability. The dashboard owns projection and
redaction. The clinical command system would still own validation, auditing,
transactions, and side effects.

## Resource and membership graph

```text
                                     Policy
                      administrators / privacy / emergency
                                  staff directory
                                         │
                                         ▼
┌─────────────────────┐        ┌─────────────────────────┐
│ Hospital Facility   │◄───────│ Patient Record          │
│ Northstar Medical   │  via   │ PT-1001 · Cardiology    │
│                     │        │ status: admitted        │
│ ViewOperational...  │        │ severity: Moderate      │
└─────────────────────┘        └────────────┬────────────┘
                                            │ resource seats
                   ┌────────────────────────┼──────────────────────┐
                   ▼                        ▼                      ▼
             Patient (self)           Attending            Care Team#Member
                                                               │
                                            ┌──────────────────┴──────────┐
                                            ▼                             ▼
                                     Day Team#Member              Night Team#Member
                                                                          │
                                                                          ▼
                                                                     Staff person
```

The policy says `Seat.CareTeam`; it does not contain a recursion function.
Nested membership is relationship data. The synchronous BXL kernel expands the
userset graph, including nested teams, cycle-safely and within evaluation limits.

## Reactive decision flow

```text
Viewer dropdown ─┐
Patient data ─────┼─► finite snapshot ─► prepare BXL ─► capability decisions
Policy members ──┤                                      │
Team membership ─┘                                      ▼
                                           projected dashboard object
                                      (unauthorized values never rendered)
                                                         │
                                    ┌────────────────────┴──────────────┐
                                    ▼                                   ▼
                              visible sections                    visible CTAs
```

Changing the viewer immediately rebuilds the decision projection. Editing the
linked policy or membership cards changes the next projection without changing
the dashboard template.

## What each capability controls

| Capability                | Dashboard effect                                                |
| ------------------------- | --------------------------------------------------------------- |
| `ViewIdentity`            | Name, patient ID, admission status, and record header           |
| `ViewClinicalSummary`     | Diagnosis, allergies, attending, and care summary               |
| `ViewVitals`              | Blood pressure, heart rate, temperature, oxygen, and weight     |
| `ViewMedications`         | Medication list                                                 |
| `ViewInternalNotes`       | Staff-authored internal notes                                   |
| `ViewBilling`             | Charge summary                                                  |
| `ViewAuditTrail`          | Access and change history                                       |
| `ViewFacilityContext`     | Room and facility context inherited through `Resource.Facility` |
| `EditCarePlan`            | “Edit care plan” CTA                                            |
| `OrderMedication`         | “Order medication” CTA                                          |
| `BeginDischarge`          | “Begin discharge” CTA                                           |
| `ExportRecord`            | “Export record” CTA                                             |
| `ActivateEmergencyAccess` | Break-glass control; the read still requires an incident ticket |
| `RequestAccess`           | Guest-only “Request access” CTA                                 |

## Expected views

| Viewer                                    | Expected result                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Patient                                   | Identity and billing; no staff notes or clinical mutation CTAs             |
| Attending physician                       | Full clinical view and admitted-patient clinical CTAs                      |
| Nurse through nested care-team membership | Clinical view and care-plan/note CTAs                                      |
| Pharmacist                                | Identity, medications, and medication-order CTA                            |
| Billing specialist                        | Identity and billing only                                                  |
| Privacy officer                           | Identity, clinical summary, billing, audit trail, and export CTA           |
| Hospital administrator                    | Broad oversight and export; internal clinical notes remain excluded        |
| Emergency physician                       | Locator only until break-glass is enabled with an incident ticket          |
| Suspended care-team member                | Positive team membership, but explicit refusal removes notes and mutations |
| Guest consultant                          | Record locator and request-access CTA only                                 |

The three patient records have different assignments. A care-team relationship
on PT-1001 does not grant access to PT-1002 or PT-1003.

## Policy profile covered

```bxl
Seat.Patient or Seat.Attending or Seat.CareTeam
Capability.ViewClinicalSummary
via(Resource.Facility; Capability.ViewOperationalContext)
Party.Member
Party.Guest
(Seat.Attending or Seat.CareTeam) and Resource.Status == "admitted"
Seat.EmergencyClinician and Input.BreakGlass == true and Input.IncidentTicket != null
```

Explicit refusal is separate and wins after positive eligibility:

```bxl
where: Seat.Attending or Seat.CareTeam
refuse when: Seat.Suspended
```
