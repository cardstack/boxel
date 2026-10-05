## What it is

The form-level list of everything wrong, and the reason nothing gets dropped. Render it at the top of a **Form** so a refused submit has somewhere to land, and so a user can see the whole problem before hunting for it. It is not a replacement for per-field messages — **FormField** still renders its own — it is the index. For a single message about the form as a whole, use **Alert**; for one issue outside a field, use **FieldError**.

## The contract

```
@issues?          — when used without a Form
@form?            — supplied automatically by form.Summary
@title?           — defaults to a count sentence
@headingLevel?    — aria-level, default 3
@showAdvisory?    — include warnings and info, default false
@always?          — render before a submit has been attempted
@announce?        — add role='alert', off by default
<:default>
```

**`@headingLevel` is a knob, not a hardcoded `<h2>`.** A card does not know its host's outline, so forcing a level would break document structure wherever the card is embedded. This is a Boxel-specific constraint the reference implementations do not have, and getting it wrong produces heading-order violations in every consuming page.

**The correctness contract: every issue in the form appears here.** An issue whose `targetPath` matched no rendered field is rendered with an explicit "not on this form" marking rather than being filtered away. A dropped error is worse than an ugly one, and this is the only component in the territory that can prove nothing was swallowed.

The `unroutedIssues` computation depends on `ClaimSet.settled` — a flag that distinguishes "no field has claimed this path" from "no field has registered yet". Without it the summary would flash every issue as unrouted on first paint.

## Prior art

The canonical spec is **GOV.UK's Error Summary**: render at the top of `<main>` before the `<h1>`, wrap in `role="alert"`, an `<h2>` reading "There is a problem", a `<ul>` of links each `href="#fieldId"`, move keyboard focus to the summary on submit, and keep the summary text verbatim-identical to the inline message. **React Spectrum** and **SLDS** ship neither — this pattern exists as guidance, not as a component, in both.

Two deliberate deltas from the pattern as usually written:

1. **Rows are buttons, not `href="#id"` anchors.** An anchor mutates the URL, and inside a Boxel card the URL is the *card's* — a fragment jump there is a navigation, not a focus move. The button calls `focusPath()` and lands focus on exactly the element the anchor would have. This is the right call in this environment and it is worth noting that it costs you the ability to copy a link to a specific error.
2. **The shell is not **Alert****, even though it would have been one line. Alert hardcodes `role="alert"` (danger) or `role="status"` — a live region that would re-announce the whole list on every keystroke in `live` mode, and double-announce at submit on top of the focus move. **The summary announces by taking focus**, which is the whole point of it.

The third improvement over the pattern: GOV.UK's summary lists only the errors it was given. Pretui's marks unrouted issues explicitly, which is the difference between a summary you can trust and one you hope is complete.

## Accessibility

No APG pattern; the governing criteria are WCAG **3.3.1 Error Identification** and, with well-worded messages, **3.3.3 Error Suggestion**. The behavioural contract is GOV.UK's.

What is right:

- **Announcement by focus, not by live region.** `@announce` defaults to off, deliberately. Pairing `role="alert"` with a focus move double-announces; in `live` mode a live region would narrate the whole list on every keystroke.
- **Focus routing works through collapsed sections.** A summary row calls `focusPath()`, which walks up the section ancestry, opens each collapsed **FormSection** and clears its `hidden` attribute in the same tick so focus lands immediately. A user is never sent to a control they cannot see.
- Each row's target is resolved by preferring the yielded `controlId`, falling back to the first focusable element inside `[data-pretui-form-control]` (deliberately scoped so the help button is not a candidate), and finally to the field root, which carries `tabindex="-1"`.
- Heading level is authorable, so the summary does not break the host document's outline.

Gaps:

- **The summary is not focused automatically on render** — it is focused only when `Form.focusInvalid()` runs with `@focusOnInvalid='summary'`, or as the fallback when no invalid field element can be found. GOV.UK's pattern focuses the summary on page load after a server-side rejection; there is no equivalent hook here, so a form re-rendered with issues from a server round trip announces nothing until the user submits again.
- **Messages are printed verbatim from the rule author.** That is the right architectural choice — rewriting rule copy in a component is how enterprise forms end up lying about what failed — but it means WCAG 3.3.3 conformance depends entirely on how the rules were written, and no component can save you there.
- **`@showAdvisory` defaults to false**, so warnings and info are absent from the summary by default while still appearing on their fields. That is defensible (the summary is a blocking-issues index) but it means the summary is *not* a complete list of what the form is saying unless you turn it on.
- The unrouted marking is visible text, not a distinct role or state — assistive tech hears it as part of the row, which is adequate but undifferentiated.
- Buttons rather than links means the rows do not appear in a screen reader's link list, which is where some users would look for them.

## Theming

`--destructive`, `--warning`, `--pretui-info` and their on-colours for the severity tiers; `--card` or `--inset` for the shell, `--border` and `--pretui-shadow-hairline` for its edge, `--foreground` and `--muted-foreground` for heading and body ink, plus **Token**'s tokens when rule provenance is shown.

Severity is carried by the same glyph vocabulary as **Alert** (`✕` / `!` / `i`) so a field message, a summary row and a banner about the same thing read as one system. A season that retunes those hues must retune them in all three places or the correspondence breaks — and because severity is conveyed by glyph *and* hue, it survives WCAG 1.4.1 even if a season's hues collapse.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
