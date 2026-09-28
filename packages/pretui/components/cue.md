## What it is

The small text beside a control: a description, a status, an error, or a label.

One component for all four, because they differ in _role_ rather than in appearance, and getting that role wrong is the most common accessibility defect in a form.

## The contract

```
@kind?    — 'description' (default) captions | 'status' announces politely when it
            changes | 'error' is a description in the danger tone | 'label' names
@position? — which logical edge of the control this cue sits on
@tone?    — accepts the React spellings: destructive/error → danger, positive →
            success, notice → warning
@text?    — literal text; the block is the slot when a cue needs markup
@id?      — pin the cue's id so an external control can aria-describedby it.
            Otherwise the id is per-instance and unique
@decorative? — purely decorative; hidden from assistive tech entirely

<:default> — the cue's content when it needs markup
```

**`@kind` is the whole component.** A description is referenced by `aria-describedby`; a label _names_; a status announces politely when it changes; an error is a description in the danger tone. Four different relationships to a control, one component, and the arg makes the choice explicit rather than implied by where it was placed.

**The id is per-instance and unique unless pinned.** `@id` exists for the case where an external control needs to point at the cue, which is the one situation where a generated id will not do.

**`@decorative` hides it entirely** — for a cue that repeats something already announced.

**Tone accepts the React spellings**, so an agent reaching for `destructive` or `positive` gets the right hue rather than nothing.

## Prior art

The help-text, error-text and label components that most kits ship separately.

Where Pretui is better: one component with a role arg. Shipping three separate components means the choice between them is made by visual similarity — which is how help text ends up announced as an error and an error ends up announced as nothing.

Where it is thinner: no icon slot, no dismissal, and no multi-line structure — a cue is a line of text.

## Accessibility

- **`@kind` selects the ARIA relationship**, which is the component's reason to exist.
- **`'status'` announces politely on change**, which is correct for a live validation hint and wrong for static help text — the arg is how you say which you have.
- **`'error'` is a description in the danger tone**, not a live region: an error that announces itself on every keystroke is the failure this avoids.
- **`@decorative` removes it from the tree**, which is the honest way to repeat something visually without repeating it aloud.
- **A pinned `@id` is a promise**: the control pointing at it must exist, or the reference dangles.

## Theming

Tone resolves through the kit's shared semantic hues; position and kind are structural.

There is no cue-specific palette, which is what keeps an error beside a field the same red as an error anywhere else in the season.
