---
status: proposed
date: 2026-10-20
scope:
  - packages/boxel-ui/**
  - packages/pretui/**
  - packages/host/app/**
  - packages/base/**
  - packages/*-realm/**
  - packages/*/realm/**
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
boxel-ui is deprecated, and a migration will empty it so it can be removed.
New UI uses Pret UI. boxel-ui gets only fixes and changes that help code
migrate away from it. Its shared stylesheets can take new tokens and other
changes until they move to host.

## 1. Decision

### 1.1. New code uses Pret UI components

New code MUST NOT import a component from `@cardstack/boxel-ui/components`
when Pret UI has a component for the same job. It MUST use the Pret UI
component instead. This applies to host code, base cards, and cards in every
realm.

When neither library has the component, helper, or modifier a change needs,
the change MUST add it to Pret UI if cards can use it, or to host if only host
uses it. It MUST NOT add it to boxel-ui.

### 1.2. boxel-ui is frozen

boxel-ui MUST NOT gain new components, new exports, or new arguments on
existing components. It MAY take bug fixes, accessibility fixes, and changes
that help code migrate away from it.

The shared stylesheets already in `packages/boxel-ui/src/styles/` are not
frozen. Until they move to host (§1.3), they MAY take new `--boxel-*` tokens
and changes to the variables, the theme contract and the global CSS.

### 1.3. What new code may still take from boxel-ui

Each kind of boxel-ui export has a destination:

- Components go to Pret UI, or to host when only host uses them.
- Helpers and modifiers go to Pret UI when cards can use them, and to host
  otherwise.
- Icons go to boxel-icons (`@cardstack/boxel-icons`).
- Style tokens and the theme contract go to host, keeping their `--boxel-*`
  and theme names.

New code outside Pret UI MAY import a boxel-ui export whose destination has
no counterpart for it yet. Such an import SHOULD move to the destination when
the counterpart arrives. Reading a `--boxel-*` or theme custom property is not
an import, and its name stays when the stylesheets move.

### 1.4. Existing imports migrate, and boxel-ui is removed

The end state is an empty boxel-ui, removed under §1.6. A planned migration,
tracked outside this ADR, moves existing boxel-ui imports to their
destinations (§1.3), so they are not gaps under this ADR. Until the migration
reaches it, a change that substantially rewrites a template SHOULD move that
template's boxel-ui imports.

### 1.5. Guidance points to Pret UI

Skills, `AGENTS.md`, and other agent guidance in this repository MUST NOT
direct new code to a boxel-ui export whose destination (§1.3) has a
counterpart. Where guidance says to reach for a shared component, it MUST
name Pret UI, or host for components only host uses. Guidance about style tokens MUST name the tokens themselves,
and MUST NOT point to a file in boxel-ui as their home.

### 1.6. Pret UI stands alone, then boxel-ui goes

Pret UI MUST NOT import `@cardstack/boxel-ui` or depend on it. Where Pret
UI needs a boxel-ui module, that module MUST move to its destination under
§1.3. Reading a `--boxel-*` or theme custom property is not a dependency
(§1.3).

boxel-ui MUST NOT be removed while code in this repository, the catalog,
boxel-home, or boxel-skills still imports it. Imports in user-realm cards,
which we can't edit, don't block removal. After removal, host MUST keep the
`@cardstack/boxel-ui/*` paths resolvable for those cards as deprecated paths,
indefinitely, as warranted by measured usage.

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
workspace package (`packages/pretui/README.md`). Card code will also reach
Pret UI through a host shim, as it reaches boxel-ui, so prerendered and live
markup come from the same bundle. Each component has a Spec
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

Not everything in boxel-ui belongs in Pret UI. Pret UI is for what cards can
use. Host chrome such as card headers and pickers serves operator mode only,
so it moves to host. Icons already have a library in boxel-icons. The
stylesheets are platform runtime that host loads before any card, so they
move to host with their names unchanged, and the code that reads them
doesn't change. The freeze leaves them out (§1.2) because they aren't a
component library: they hold the tokens that host, Pret UI and cards read
today, and those tokens need maintaining until the move.

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

Keeping the deprecated paths for user-realm cards (§1.6) needs host to
measure how often they are still loaded.

## 5. Remediation

Known gaps are listed in [remediation/009.md](remediation/009.md).
