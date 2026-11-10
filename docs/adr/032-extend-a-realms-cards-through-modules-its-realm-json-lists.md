---
status: proposed
date: 2026-11-09
scope:
  - packages/base/realm-extension.ts
  - packages/base/realm-config.gts
  - packages/base/workspace.gts
  - packages/runtime-common/realm.ts
  - packages/host/app/services/realm-extensions.ts
  - packages/host/app/components/operator-mode/stack-item.gts
  - packages/host/app/components/operator-mode/operator-mode-overlays.gts
  - packages/host/app/components/operator-mode/preview-panel/index.gts
  - packages/host/app/components/operator-mode/code-submode/playground/playground-panel.gts
  - packages/host/app/components/ai-assistant/answer-card.gts
  - packages/host/app/components/matrix/room-message-tool.gts
---

# 032. Extend a realm's cards through modules its `realm.json` lists, run only in the browser

A card's class can add items to that card's menu with `[getMenuItems]`, but
some behavior belongs to the realm, not to any card type: "Pin to Workspace"
applies to every card in a realm whose home is a Workspace, whatever the
card's class. A realm declares such behavior as extension modules: code refs
in its `realm.json` to exports with the `RealmExtension` shape. The host loads
them and asks each one for what it adds, starting with menu items. The realm
server only passes the list through as data.

## 1. Decision

### 1.1. Declaration

A realm MUST declare its extensions in the `realmExtensionModules` field of
its RealmConfig card, as a list of code refs. Each code ref MUST name an export
with the `RealmExtension` shape from `@cardstack/base/realm-extension`. The
export MAY be a card class, such as `Workspace`, or any other export. A
relative module resolves against `realm.json`.

### 1.2. The realm server reads extensions as data

The realm server MUST NOT import an extension module or run its code (ADR 015
§1.1 gives the reason). It MUST drop each entry that is not a code ref, and
MUST serve the rest in `RealmInfo.realmExtensionModules` with each module as
an absolute RRI (ADR 002 §1.3).

### 1.3. An extension applies only to its own realm's cards

The host MUST apply a realm's extensions only to cards in that realm. It MUST
pass each hook the realm that lists the extension, as `params.realm`.

### 1.4. One entry point for a card's menu

Host code that builds the menu for a card instance MUST get it from
`RealmExtensionsService.cardMenuItems`, not by calling `[getMenuItems]`
directly. The host SHOULD place extension items after the card's own items
and before the first dangerous item.

### 1.5. Hooks are synchronous and fail alone

A hook such as `provideMenuItems` MUST return synchronously. The host calls it
whenever a card's header renders, not only when its menu opens, so a hook
MUST NOT start a request. Work that waits MUST go in the action of an item it
returns. The host MUST NOT wait for an
extension module to load before it renders a menu: until the module loads,
the menu shows without that extension's items. An extension that fails to
load or throws MUST cost only its own items.

### 1.6. Loader lifecycle

The host MUST cache a loaded extension per Loader instance, so that a code
change takes effect when the host replaces its loader.

### 1.7. New extension points

A new extension point SHOULD be an optional static member of
`RealmExtension`, named `provide<Thing>`. It SHOULD take its subject and a
params object that includes `realm`.

## 2. Rationale

`[getMenuItems]` reaches only cards whose class the author controls. A realm
holds cards of base, catalog and other realms' types, and behavior such as
pinning has to reach all of them. Today the only way to add such behavior is
to change base's default menu and the host for every feature, and base then
has to know when each feature applies. An extension inverts that: the
Workspace card owns its pin item, and a realm opts in by listing it.

`realm.json` is where a realm already states its settings, and the realm
server already copies some of them into `RealmInfo`. The host loads
`RealmInfo` for every realm at boot and keeps it tracked, so a menu can read a
realm's extensions without a request of its own.

Extension code runs only in the browser, which is built to contain card code.
Because an extension applies only to its own realm's cards, it runs only while
the user is working with that realm's cards, and so gains no reach that the
realm's card code does not already have.

Menus render synchronously. An asynchronous hook would make every menu wait
on its slowest extension, or redraw once each one answers.

## 3. Considered options

- **Extension modules listed in `realm.json` (chosen).** A realm opts in to
  each extension, and base needs no knowledge of the features extensions add.
- **Hardcode each realm-level item in base's default card menu**, with a host
  service deciding when it applies. This works for one feature. Each new one
  then needs changes to base and to the host, and base's default menu grows
  knowledge of Workspace and of every later feature.
- **Treat the class of the realm's index card as its extension.** No new
  field is needed. But a realm gets at most one extension, a realm with a
  custom index card loses the behavior, and a realm cannot opt out.
- **Have the host read `realm.json` from the store for each menu.** No change
  to `RealmInfo` is needed, but the host fetches a card and loads the
  RealmConfig module for each realm before its first menu.
- **Asynchronous hooks.** These are simpler to write, for the cost given in §2.

## 4. Consequences

A hook can read only what its params carry. An extension that chooses its
items from state, such as showing "Unpin" for a card that is already pinned,
has no synchronous source for that state yet, and adding one widens
`RealmExtensionMenuItemParams`.

Overlays on prerendered cards have an id but no card instance, so they show
no extension items.

## 5. Sources

- `packages/base/menu-items.ts`: the default card menu that `[getMenuItems]`
  builds.
- #7318: pinning a card from its menu by adding the item to base's default
  menu, the second option above.

## 6. Remediation

Known gaps are listed in [remediation/032.md](remediation/032.md).
