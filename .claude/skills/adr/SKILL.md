---
name: adr
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
description: Write, supersede, or backfill Architecture Decision Records in docs/adr/ — the record of why the codebase is shaped as it is. Covers when a change warrants an ADR (hard to reverse, cross-cutting, chosen between viable alternatives, or something a reviewer would defend), numbering and frontmatter (status, date, scope globs), drafting from the template, the rule that every rationale claim in a retroactive ADR cites a source or is listed as an open question, superseding instead of editing, and keeping ADRs free of private-tracker IDs and production data. Use when making or proposing an architectural decision in a PR, when a PR's "Key decisions" outlive the PR, when asked to write/draft/backfill/supersede an ADR, and before changing or reversing a rule in code that an ADR's scope covers.
---

# Architecture Decision Records

ADRs live in `docs/adr/`. Read `docs/adr/README.md` first: it holds the bar for
when to write one, the lifecycle, and the index.

## Before changing code an ADR covers

If you are about to reverse, work around, or loosen an established pattern,
check for an ADR that covers it:

```sh
grep -l '<path or package>' docs/adr/[0-9]*.md
```

An `accepted` ADR is a decision the team made on purpose. Don't silently
contradict it. Either follow it, or tell the user that the change conflicts
with ADR NNNN and that it needs a superseding ADR.

## Writing a new ADR

1. **Check the bar.** It must be hard to reverse, cross-cutting, a choice between
   viable alternatives, or something a reviewer would defend. If it isn't, the
   PR's "Key decisions" section is the right home. If unsure, ask the user
   rather than writing one.
2. **Number it.** Use the next free number:
   `ls docs/adr/[0-9]*.md | tail -1`. Name the file
   `NNNN-kebab-case-title.md`. The title is the decision as an imperative
   ("Split migrations into additive and removal phases"), not a topic
   ("Migrations").
3. **Copy `docs/adr/template.md`** and fill it in:
   - `status: proposed`. Never set `accepted` yourself; a person does that.
   - `date` is when the decision was made.
   - `scope` lists globs precise enough that the `grep` above finds the ADR
     from the code it governs.
   - **Considered options** is the most valuable section for future readers.
     Name the alternatives a newcomer would reach for, and say why each lost.
   - **Consequences** ends with the rules this imposes, phrased so a reviewer
     can check them.
4. **Add a row to the index** in `docs/adr/README.md`.
5. **Keep it short.** About a page. Link to `docs/*.md` design docs and skills
   for mechanics rather than restating them.

## Backfilling a retroactive ADR

The danger in a backfill is writing down a plausible reason nobody actually
had. A confabulated "why" misleads readers more than a missing ADR does.

- Set `retroactive: true`, `date` to when the decision was made (from
  `git log` / PR merge dates), and `recorded` to today.
- **Every claim about _why_ cites a source in the Sources section.** Use a
  commit SHA, a PR in this repository (`gh pr view N --json body`), a review
  thread, or a file and line that states it. A reason you inferred but no
  source states goes under **Open questions**, with the authors of the key
  commits as the people to ask. Don't put it in Context or Considered options.
- Rejected alternatives follow the same rule. List only alternatives a source
  shows were considered. If none are recorded, say so under Open questions.
- Describe the decision as it stands in the code today, and verify that by
  reading the code. If the code has drifted from the original decision, say
  so. That drift may itself need a superseding ADR.

## Superseding

Don't edit the decision of an `accepted` ADR. Write a new ADR with
`supersedes: NNNN`. Set the old one's `status: superseded` and
`superseded-by: MMMM`. Update both rows in the index. Fixing typos, links, and
`scope` globs after a file move is fine without superseding.

## Public repository

`docs/adr/` is public. An ADR may cite commit SHAs, PR numbers in this
repository, and file paths. In a Sources section, that history is the point,
so the `evergreen-comments` rule against PR references does not apply there.
The rest of the ADR follows `evergreen-comments`.

ADRs never contain:

- private-tracker IDs or quotes from tickets,
- production or staging data,
- user data.

If a decision's rationale lives only in a private source, write the public
reasoning in your own words. If it can't be stated publicly, leave it as an
Open question. Load `pr-privacy` before writing anything drawn from logs, the
database, or a user's realm.
