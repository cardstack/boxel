---
name: adr
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
description: Write, supersede, or backfill Architecture Decision Records in docs/adr/ — short, normative records (BCP 14 MUST/SHOULD requirements, numbered sections) of why the codebase is shaped as it is, with the options each decision rejected. ADR 001 is the normative source for the format; this skill is the procedure. Covers when a change warrants an ADR, numbering and frontmatter (status, date, scope globs that scripts/adr-for.mts matches against paths), drafting from the template, the deletion pass, the rule that every reason in a retroactive ADR cites a source or is listed as an open question, superseding instead of editing, citing ADRs by section, and keeping ADRs free of private-tracker IDs and production data. Also covers a proposed ADR's remediation file (docs/adr/remediation/<number>.md): surveying its scope for code that doesn't conform yet, closing those gaps in later PRs, and getting the ADR ready for a person to accept. Use when making or proposing an architectural decision in a PR, when a PR's "Key decisions" outlive the PR, when asked to write/draft/backfill/supersede an ADR, when fixing code an ADR's remediation file lists or bringing a proposed ADR to acceptance, and before changing or reversing a rule in code that an ADR's scope covers.
---

# Architecture Decision Records

Read `docs/adr/001-record-architecture-decisions.md` first. It defines the
format, lifecycle, and enforcement, and this skill cites it by section rather
than restating it.

## Before changing code an ADR covers

If you are about to reverse, work around, or loosen an established pattern,
find the ADRs that govern the files you're touching:

```sh
node scripts/adr-for.mts <path>...
```

Read each `accepted` or `proposed` ADR it lists. Follow its MUST requirements.
Under each ADR, the script also prints the known gaps its remediation file
lists for the paths you gave it. Don't read the whole remediation file unless
you are closing gaps or surveying the ADR's scope. If the change can't, tell the user
which requirement it breaks ("ADR 004 §1.2"). For an accepted ADR, the change
needs a superseding ADR. For a proposed ADR, it needs a reviewed edit to the
ADR's Decision (ADR 001 §1.6). Departing from a SHOULD needs a reason stated
in the PR (ADR 001 §1.9).

A `proposed` ADR binds new code the same way, including in the PR that adds
it. Code listed in its remediation file is a known gap: you may leave it
as it is, but don't copy it into new code (ADR 001 §1.9). If your change
closes a gap, remove its entry in the same PR. If you find a gap that isn't
listed, add it.

## Writing a new ADR

1. **Check the bar** (ADR 001 §1.1). If the decision doesn't meet it, the
   PR's "Key decisions" section is the right home. If you're unsure, ask the
   user.
2. **Number it.** `ls docs/adr/[0-9]*.md | tail -1` gives the highest
   number. Use the next one, with three digits.
3. **Copy `docs/adr/template.md`** and fill it in (ADR 001 §1.2–§1.4):
   - Set `status: proposed`. Never set `accepted` (§1.6).
   - Write `scope` as a YAML list, one glob per line, precise enough that
     `scripts/adr-for.mts` finds this ADR from the code it governs. Check it
     by running the script on a file the ADR governs.
   - Write the summary paragraph last, once you know what the ADR says.
   - In the Decision, write one requirement per sentence with a BCP 14 key
     word. Use MUST only for what a reviewer should block on. Use SHOULD for a
     default that can be departed from with a stated reason.
   - In Considered options, name the alternatives a newcomer or an agent
     would reach for, and say why each lost. This section is what stops a
     rejected design from being proposed again.
   - **Survey the scope for gaps** (ADR 001 §1.6). Search the code the
     `scope` globs cover for places that break a MUST or MUST NOT. List each
     in `docs/adr/remediation/<number>.md`, started from
     `docs/adr/remediation/template.md`, by file (and symbol, when the gap
     is narrower) with the requirement it breaks. Name each file by its path
     from the repository root, in backticks, so `scripts/adr-for.mts` can
     match it. The ADR's last section, Remediation, holds only a link to the
     file. Don't fix them in the ADR's
     PR unless the fix is small. The ADR can merge first, and the remediation
     follows in separate PRs. If a gap is in a file outside `scope`, widen
     `scope` to cover it. If there are no gaps, write "No known gaps." in
     the file. Never leave the file out: a proposed ADR without one can't be
     told apart from one nobody surveyed.
4. **Make the deletion pass** (§1.5). Reread the draft only to cut: restated
   mechanics a linked doc or skill already covers, Consequences that repeat
   the Decision, and hedges. Expect a page or less.
5. **Add the index row** in `docs/adr/README.md`.

## Backfilling a retroactive ADR

The danger in a backfill is writing down a plausible reason nobody actually
had. Follow ADR 001 §1.7:

- Find the decision date with `git log` and PR merge dates.
- Find stated reasons in commit messages, PR descriptions
  (`gh pr view N --json body`), review threads, and the skills and docs that
  enforce the rule.
- Cite each reason in Sources. Put a reason you inferred, but that no source
  states, under Open questions. Name the authors of the key commits as the
  people to ask.
- When someone answers an open question, put the answer where it belongs
  (Rationale or Considered options), cite it in Sources as
  "<name>, <date>", and delete the question. Use their words; don't embellish
  the reason.
- Write the Decision from the code as it stands today, verified by reading it.
  If the code has drifted from the original decision, say so. The drift may
  need a superseding ADR.

## Remediating and accepting a proposed ADR

Track remediation work on the issue tracker, and link the ADR from the
tickets. The remediation entries themselves name only paths and requirements
(ADR 001 §1.8).

Each remediation PR removes the entries it closes. If the work shows that a
requirement is wrong, change the Decision in a PR instead of leaving the gap
open, and keep the existing subsection numbers (ADR 001 §1.6). When the last
entry goes, replace it with "No known gaps." and tell the user that the ADR is
ready to accept. A person then sets `accepted`, deletes the Remediation
section and the remediation file, and updates the index row, all in one
change.

## Superseding

Write a new ADR with `supersedes`. Then set the old ADR's `status: superseded`
and `superseded-by`, and update both index rows (ADR 001 §1.6).

## Citing ADRs elsewhere

In skills, `AGENTS.md`, code comments, and reviews, cite a rule as
"ADR NNN §x.y" instead of restating it (ADR 001 §1.5).

## Public repository

`docs/adr/` is public (ADR 001 §1.8). In an ADR's Sources section, citing
commit SHAs and PR numbers is the point, so the `evergreen-comments` rule
against PR references does not apply there. The rest of the ADR follows
`evergreen-comments`. If a decision's rationale lives only in a private
source, write the public reasoning in your own words. If it can't be stated
publicly, leave it as an Open question. Load `pr-privacy` before writing
anything drawn from logs, the database, or a user's realm.
