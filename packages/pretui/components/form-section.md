## What it is

A real `<fieldset>` grouping related fields under a legend, with an issue count, an optional disclosure, and — the part that matters — the ability to open itself so focus routing can reach a control hidden inside it. Use it to break a long form into named groups. If you only need columns, use **FormLayout**; if you want an independently collapsible panel that is not part of a form, use **Accordion**.

## The contract

```
@title?, @description?, @collapsible?, @open?, @defaultOpen? (true), @onOpenChange?
@disabled?, @paths?, @issues?, @hideIssueCount?, @span?, @form?
<:default as |section|>   — { Field, Layout, open, issues }
<:actions>
Element: HTMLFieldSetElement
```

Four decisions, and they interlock.

**It is a native `<fieldset>` with a `<legend>`.** `@title` is the group's accessible name, and `@disabled` is native fieldset disabling — every control inside goes dead while the disclosure button keeps working, because the browser exempts the first legend's contents.

**A collapsed section hides its body with `hidden`, it does not drop it from the DOM.** So the fields inside are always constructed, always registered, and their issues always route — even while the section is shut. The cost is stated plainly in the source: collapsing saves no render work. For a section whose content is genuinely expensive, render it lazily yourself and declare `@paths` so the count still works.

**Because the fields exist, focus routing can reach them.** The section registers a reveal callback with the form. An **ErrorSummary** row or a refused submit walks up the section ancestry, calls each reveal, clears `hidden` on the spot so focus lands in this tick, and the subsequent render writes back the same value.

**And it auto-expands once a commit has been refused and it holds a blocking issue.** A user cannot fix what they cannot see, and leaving them to hunt through disclosures is the enterprise-form sin this whole territory exists to avoid.

The yielded `Field` and `Layout` are pre-curried with both the form context *and* this section, so a two-column arrangement inside a section still counts toward the section's badge.

## Prior art

**SLDS** has no collapsible form section as a component; its record pages use `slds-section` with an `slds-section__title-action` button and leave the wiring to you. **Radix `Accordion`** is the closest disclosure primitive — `type`, `value`, `collapsible`, `Item`/`Header`/`Trigger`/`Content` — but it is a generic disclosure with no relationship to form state, and its `Content` unmounts by default (`forceMount` is opt-in). **Web Awesome `wa-details`** and `wa-accordion` likewise know nothing about validation.

Pretui's departure is the whole value: **a disclosure that is aware of the form's issue state.** Three behaviours no general accordion can offer —

- the legend carries a live issue count, which is the collapsed section's only synchronous signal that something is wrong inside it (`@hideIssueCount` exists but leaving it on is strongly advised);
- the section auto-expands on a refused submit when it holds a blocking issue;
- the section can be opened *by the form*, on demand, so an ErrorSummary row can land focus inside it.

Using Radix Accordion plus a form library gets you none of these without writing the coordination yourself, and the coordination is the hard part.

The trade against Radix: `forceMount`-always means no render savings from collapsing, and Radix's height-animation custom properties (`--radix-accordion-content-height`) have no equivalent here.

## Accessibility

Governing patterns: the native `<fieldset>`/`<legend>` grouping, plus APG **Disclosure** for the collapsible case (trigger is a button with `aria-expanded`; no arrow keys, no roving tabindex, Enter/Space toggle — that is the entire keyboard contract, and the arrow keys people expect come from APG's *example*, not the pattern).

What is right:

- **Real `<fieldset>` + `<legend>`.** The group has an accessible name that assistive tech announces when entering it, which no `role="group"` + `aria-label` reconstruction does as reliably.
- `@description` is wired to the fieldset with `aria-describedby` — not left as adjacent prose.
- **`hidden` rather than unmount** means the accessibility tree is consistent: a hidden section's fields are absent from the tree while shut, and present the instant it opens, without a mount race.
- **Auto-expand on refused submit** is the accessibility behaviour, not just a convenience: a keyboard or screen-reader user is never told "3 errors" and then given no path to two of them.
- Native fieldset `@disabled` is announced per control by the platform.

Gaps:

- **`aria-expanded` lives on the disclosure button, but the body has no `id`/`aria-controls` link** unless the implementation adds one — check before relying on it; APG makes `aria-controls` optional, so this is a soft gap rather than a failure.
- **The issue count in the legend is not a live region.** It changes as issues arrive and nothing announces it. For a collapsed section that is exactly the moment announcement would help, and it is the clearest addition to make.
- **A `<legend>` that contains a button plus a count plus an actions slot** is a rich accessible name. Everything inside the legend contributes to the group's name, so a section titled "Line items" with a count and an "Add" link may be announced as "Line items 2 errors Add, group". Keep `<:actions>` short, and consider whether the count belongs outside the legend.
- **Auto-expand changes context without user action.** It is the right behaviour, but WCAG **3.2.2 On Input** territory is nearby; it is triggered by the user's own submit, which keeps it compliant, but a section opening under a user who did not ask is still worth a live-region announcement.
- No `aria-level` or heading semantics on the legend, so a long form's sections do not appear in a heading list.

## Theming

`--border` and `--pretui-shadow-hairline` for the fieldset edge, `--foreground` for the legend, `--muted-foreground` for the description, `--destructive` / `--warning` / `--pretui-info` for the issue count tiers, plus whatever **FormField** and **FormLayout** consume inside.

`data-pretui-form-section` (carrying the section id) and `data-pretui-form-section-body` are structural hooks the form's focus routing depends on — a season must not repurpose or remove them. `@span` defaults to spanning every column of an enclosing FormLayout, which is almost always what a section should do.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
