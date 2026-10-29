---
status: proposed
date: YYYY-MM-DD
scope: # globs this decision governs, one per line
  - packages/example/**
# supersedes: NNN
# retroactive: true
# recorded: YYYY-MM-DD
---

# NNN. Decision stated as an imperative

One paragraph that summarizes the decision and why it matters, so a reader can
tell whether the rest is relevant.

## 1. Decision

### 1.1. First rule

Each requirement in its own sentence, with a BCP 14 key word.

## 2. Rationale

Why, in prose: the forces at the time of the decision.

## 3. Considered options

- **Chosen option.** Why it won.
- **Alternative.** Why it was rejected.

## 4. Consequences

Optional. Delete unless it adds value beyond the Decision.

## 5. Open questions

Retroactive ADRs only. Each reason no source states, and whom to ask.

## 6. Sources

Commit SHAs, PRs in this repository, and file paths that the ADR rests on.
Required for retroactive ADRs.

## 7. Remediation

Required while proposed. Each known gap: the file (and symbol, when the gap is
narrower) where the code does not yet meet the Decision, and the requirement it
breaks. Write "No known gaps." when there are none. Delete on acceptance.

- `packages/example/old-path.ts` (`legacyLoad`) breaks §1.1.
