# Talent & Resource Tracker (HRIS & ATS)

An applicant tracking system and employee resource manager, built as a
self-contained app directory (not a catalog listing). It exists to cover these
periodic-table building blocks:

| Kind      | Block                                               | Where                                                                                        |
| --------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Field     | Score                                               | `score-field.gts` → Candidate.overallScore, Meeting.interviewScore, Vendor.performanceRating |
| Field     | Duration                                            | `duration-field.gts` → Employee.tenure, Candidate.timeToHire, Meeting.duration, contracts    |
| Field     | Start Date                                          | base DateField → Employee.startDate, Vendor.contractStart, Project.startDate                 |
| Card      | Employee, Candidate, Team, Meeting, Project, Vendor | one module each in the app root                                                              |
| Component | Calendar                                            | `components/calendar.gts` (hand-rolled month grid; interview chips)                          |
| Component | Card List                                           | `components/card-list.gts` (local copy of the catalog component)                             |
| Component | Tree                                                | `components/org-tree.gts` + `buildOrgTree` (manager-hierarchy org chart)                     |
| Tool      | Extract                                             | `commands/extract-resume-command.gts` (LLM resume parsing)                                   |
| Tool      | Prompt                                              | `commands/generate-interview-questions-command.gts`                                          |
| Tool      | Approve                                             | `commands/approve-offer-command.gts` (candidate → onboarding Employee)                       |
| Tool      | Reject                                              | `commands/reject-candidate-command.gts`                                                      |

## Demo

Open `TalentResourceTracker/tracker`. Tabs: Dashboard (stat tiles + linked
teams/projects/vendors), Directory (query-driven employee list), Pipeline
(candidates by stage; Approve/Reject buttons on offer-stage cards), Calendar
(August 2026 holds the seeded interviews), Org Chart (Sofia → Marcus/Dana →
Priya/Leo).

Suggested walkthrough: run Extract Resume on `Candidate/applied-jordan` (has
pasted resume text), Generate Interview Questions on
`Candidate/interviewing-amara`, then Approve the offer for
`Candidate/offer-tomas` and watch the new employee appear in the Directory and
Org Chart.

## Notes

- The Calendar and Org Chart tabs read the tracker card's `linksToMany`
  collections, so new Meetings/Employees must be linked to the tracker to show
  there. The Directory tab queries the realm and is immune.
- No `CardListing`/`Screenshots`/`ListingThumbnails` on purpose — Specs for
  every exported def live in `Spec/`.
