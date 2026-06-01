---
name: boxel-ui-component-discovery
description: MANDATORY before writing any UI in a `.gts` template. Search the catalog for a boxel-ui component Spec and reuse it. Fall back to raw HTML only when no matching spec exists, and surface the gap when you do.
---

# Boxel UI Component Discovery

## Mandatory rule

Before you write any UI in a `.gts` template — anything you'd describe
as a UI primitive (button, input, dropdown, modal, tooltip, pill, menu,
accordion, …) — **you must first search the catalog for an existing
boxel-ui component Spec and reuse it.**

- A matching spec exists → import it via `attributes.ref` and follow
  the API table in `attributes.readMe`. No raw `<button>`, `<input>`,
  `<textarea>`, `<select>`, `<details>`, etc. Visual styling — even
  unconventional aesthetics — is never a reason to drop down to raw
  HTML. Restyle via the component's documented CSS-variable surface.
- No spec matches → write minimal idiomatic HTML and append a comment
  to the issue's `attributes.comments[]` describing what you searched
  for and why nothing fit, so the gap is visible. Don't invent a
  `@cardstack/boxel-ui/components` import that wasn't in the search
  results — names not present in the catalog don't exist for your
  purposes.

This rule is intentionally not a fixed HTML→component mapping. The
catalog's inventory changes over time and the spec readMe is the source
of truth for what's available and what each component is called.

## Procedure

1. **Enumerate first.** Before any search, read the brief and your
   planned template and list every UI primitive it implies — in plain
   language ("button", "dropdown", "tag-style indicator", "expandable
   section"). The partial-compliance failure mode is "agent finds one
   match, uses it, hand-rolls everything else" — enumerating up front
   prevents it.

2. **Query the catalog once, broadly.** Use the catalog realm URL from
   the system prompt's Realms section (`Catalog realm: <url>`). Do not
   guess `https://app.boxel.ai/catalog/` or any other host.

   ```sh
   boxel search --realm <catalog-realm-url-from-system-prompt> --query '{
     "filter": {
       "type": { "module": "https://cardstack.com/base/spec", "name": "Spec" },
       "eq":   { "specType": "component" }
     }
   }' --json
   ```

   One broad query returns the full inventory (~50 specs). Match each
   item in your enumeration to a result by reading `attributes.cardTitle`
   and `attributes.cardDescription`. Narrow with `contains` on the title
   or `matches` (full-text over the readMe) if the inventory is large
   enough to be noisy. See `boxel-api` for full query syntax.

3. **Read each chosen spec's `attributes.readMe`** — it has the Import
   line, the API table (arg / type / required / default / options /
   description), an example snippet, and CSS variables. The readMe
   rides on the search response; no follow-up fetch needed.

4. **Use the components.** Translate each `attributes.ref` to an
   import line directly (the `Import` section of the readMe gives you
   the exact statement). Copy the example as a template and substitute
   your own args following the API table. Required args must be
   present; defaults are listed for every optional arg.

## Self-audit before `signal_done`

Re-read your finished template. For each interactive or form-shaped
HTML element it contains, ask: would I have searched the catalog for
this if I were writing it from scratch? If yes, did I? Replace any raw
HTML primitive that has a spec'd equivalent, re-run the validators,
then call `signal_done`. Raw `<input>` / `<select>` / `<details>` lint
and parse clean — only this audit catches them.
