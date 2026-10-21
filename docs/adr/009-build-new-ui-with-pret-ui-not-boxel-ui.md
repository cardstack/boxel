---
status: proposed
date: 2026-10-20
scope:
  - packages/boxel-ui/**
  - packages/pretui/**
  - packages/host/app/**
  - packages/base/**
  - packages/experiments-realm/**
  - packages/software-factory/**
  - .claude/skills/gts-component-conventions/**
  - AGENTS.md
---

# 009. Build new UI with Pret UI, and deprecate boxel-ui

Boxel has two component libraries: boxel-ui (`packages/boxel-ui`) and Pret UI
(`packages/pretui`). Two libraries for the same job duplicate work and leave
authors, people and agents alike, unsure which one to use. We consolidate on
Pret UI. It covers more of what host and card authors need, and it is built
the Boxel way: it lives in a realm, and each component comes with a Spec card.
boxel-ui is deprecated. New UI uses Pret UI. boxel-ui gets only fixes until
nothing imports it, and then it is removed.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. New code uses Pret UI components

New code MUST NOT import a component from `@cardstack/boxel-ui/components`
when Pret UI has a component for the same job. It MUST use the Pret UI
component instead. This applies to host code, base cards, and cards in every
realm.

When neither library has the component a change needs, the change MUST add it
to Pret UI, not to boxel-ui.

### 1.2. boxel-ui is frozen

boxel-ui MUST NOT gain new components, new exports, or new arguments on
existing components. It MAY take bug fixes, accessibility fixes, and changes
that help code migrate away from it.

### 1.3. What new code may still take from boxel-ui

New code outside Pret UI MAY import a boxel-ui component, helper, modifier,
icon, or style token that Pret UI has no counterpart for yet. Such an import
SHOULD move to Pret UI when Pret UI gains the counterpart.

### 1.4. Existing imports migrate over time

Existing boxel-ui imports are not gaps under this ADR. A change that
substantially rewrites a template SHOULD move that template's boxel-ui
imports to Pret UI.

### 1.5. Guidance points to Pret UI

Skills, `AGENTS.md`, and other agent guidance in this repository MUST NOT
direct new code to boxel-ui components or style tokens. Where guidance says
to reach for a shared component or token, it MUST name Pret UI.

### 1.6. Pret UI stands alone, then boxel-ui goes

Pret UI MUST NOT import `@cardstack/boxel-ui` or depend on it. Where Pret
UI needs a boxel-ui module, it MUST take its own copy of that module into
Pret UI. boxel-ui MUST NOT be removed while any package still imports it.

## 2. Rationale

The two libraries overlap for most common controls: buttons, inputs, menus,
modals, tooltips, pills and many more. Each overlap is a choice an author has
to make without a rule to make it by. Agents make it inconsistently from one
session to the next, and reviewers cannot tell a deliberate choice from an
accident. Both libraries also need fixes, theming and accessibility work, so
the team does each of those twice.

Pret UI is the better place to consolidate. It has several times as many
components, including forms, data display, media, structure and motion
components that boxel-ui does not have. It is served as the realm
`@cardstack/pretui/`, so cards import it through the realm loader and the
index tracks the dependency, while the host imports the same source as a
workspace package (`packages/pretui/README.md`). Each component has a Spec
card in the catalog, with usage pages and examples, so it is documented and
found the same way as any other Boxel definition. boxel-ui is an Ember addon
built outside the realm system, documented in a separate docs app.

Pret UI cannot replace boxel-ui while it is built on top of it. A Pret UI
that imports boxel-ui keeps boxel-ui alive for as long as Pret UI exists, so
Pret UI must stand alone (§1.6).

Freezing boxel-ui (§1.2) stops the overlap from growing. Allowing boxel-ui
imports where Pret UI has no counterpart (§1.3), and letting old imports move
when their code is touched (§1.4), keeps the migration from blocking
unrelated work. Some boxel-ui components, such as the card and field
containers the card API renders, have no Pret UI counterpart yet.

## 3. Considered options

- **Consolidate on Pret UI (chosen).** It is the more complete library, and
  it is built as a realm with Spec cards.
- **Keep both, with a rule for which to use where.** The overlap is too large
  for a rule to settle, and every fix and theming change is still done twice.
- **Consolidate on boxel-ui.** boxel-ui would need most of Pret UI's
  components ported into it, and it would still sit outside the realm system
  with no Spec cards.
- **Merge the two into a new library.** This costs more than either of the
  other consolidations and gives nothing that adopting Pret UI does not.
- **Migrate every boxel-ui import before deprecating it.** The rule would stay
  unwritten for the length of the migration, and new boxel-ui imports would
  keep arriving while it ran.

## 4. Consequences

The `boxel-ui-guidelines` skill in cardstack/boxel-skills is outside this
repository's scope. It needs the same change as §1.5 asks of this
repository's guidance.

## 5. Remediation

- `AGENTS.md` ("CSS Guidance", "Use CSS variables from
  packages/boxel-ui/src/styles/variables.css") breaks §1.5.
- `.claude/skills/gts-component-conventions/SKILL.md` (§3, "promote it to a
  shared token in `packages/boxel-ui/src/styles/variables.css`") breaks §1.5.
- `.claude/skills/gts-component-conventions/SKILL.md` (§8, "Reach for an
  existing boxel-ui component before hand-rolling") breaks §1.5.
- `.claude/skills/gts-component-conventions/SKILL.md` (§9, "Benchmark
  boxel-ui components against reference design systems") breaks §1.5.
- `packages/pretui/package.json` (the `@cardstack/boxel-ui` dependency) and
  `packages/pretui/tsconfig.json` (the `@cardstack/boxel-ui` paths) break
  §1.6.
- These files import `@cardstack/boxel-ui`, which breaks §1.6:
  - `packages/pretui/components/accordion.gts`
  - `packages/pretui/components/avatar.test.gts`
  - `packages/pretui/components/board.gts`
  - `packages/pretui/components/board.test.gts`
  - `packages/pretui/components/board.usage.gts`
  - `packages/pretui/components/dock.usage.gts`
  - `packages/pretui/components/email-input.gts`
  - `packages/pretui/components/grid.gts`
  - `packages/pretui/components/grid.usage.gts`
  - `packages/pretui/components/input-group.gts`
  - `packages/pretui/components/input.gts`
  - `packages/pretui/components/line-grid.gts`
  - `packages/pretui/components/number-input.gts`
  - `packages/pretui/components/password-input.gts`
  - `packages/pretui/components/phone-input.gts`
  - `packages/pretui/components/search-input.gts`
  - `packages/pretui/components/select.gts`
  - `packages/pretui/components/split-panes.gts`
  - `packages/pretui/components/statement-table.gts`
  - `packages/pretui/components/table.gts`
  - `packages/pretui/components/textarea.gts`
  - `packages/pretui/components/theme-frame.gts`
  - `packages/pretui/components/token.test.gts`
  - `packages/pretui/components/url-input.gts`
  - `packages/pretui/icon-registry.gts`
  - `packages/pretui/internal/forms-picker.gts`
  - `packages/pretui/internal/reading-format.gts`
  - `packages/pretui/pretui-component.gts`
  - `packages/pretui/surfaces/canvas/index.js`
  - `packages/pretui/surfaces/grid/index.js`
  - `packages/pretui/surfaces/layout/index.js`
