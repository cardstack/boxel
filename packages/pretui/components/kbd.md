## What it is

The face of a keyboard shortcut. You give it one spec — `Mod+K` — and it renders `⌘K` on Apple platforms and `Ctrl+K` everywhere else, so no call site hard-codes a platform. It is display only: it renders a shortcut, it does not bind one. Wiring the key handler is the caller's job, and **Menu** and **CommandPalette** use this to draw the shortcut column of rows they already handle keys for.

If you want a monospace pill for a machine-readable value that is not a shortcut, that is **Token**. If you want a categorical label, **Chip**.

## The contract

```
@value (required) — a shortcut spec ('Mod+Shift+K') or a literal face ('⌘K', 'F2')
@platform?        — 'apple' | 'other', forced; detected from the browser when absent
```

**`Mod` is the whole point.** It resolves to `Meta` on Apple and `Control` elsewhere, which is the one decision that lets a single spec serve both platforms. Modifiers can be typed however the author thinks of them — `cmd`, `command`, `meta`, `super`, `win` all mean `Meta`; `opt` and `option` mean `Alt` — and are then reordered into the canonical `Control, Alt, Shift, Meta` regardless of the order they arrived in. Apple renders them as a glyph run with no separator (`⇧⌘K`), everyone else as `+`-joined words (`Ctrl+Shift+K`).

**Named keys pick up glyphs only where the platform expects them.** Arrows are universal (`↑↓←→`). `Enter`, `Backspace`, `Delete`, `Tab`, `Space`, `PageUp`, `Home` and their neighbours become `↩⌫⌦⇥␣⇞↖` on Apple and stay as words elsewhere, except `Escape`, which is `⎋` on Apple and `Esc` otherwise. A single-character key is upper-cased.

**A spec it cannot parse passes through verbatim.** Anything with no `+`, or with a modifier it does not recognise, is treated as a literal face and rendered as written. That is deliberate: the call sites that typed `⌘K` by hand before this component existed keep rendering, rather than becoming an error or an empty token.

**Platform detection is defensive.** `detectShortcutPlatform` prefers `navigator.userAgentData.platform`, falls back to `navigator.platform` and then the user-agent string, and answers `other` when there is no `navigator` at all — because this module is evaluated by the indexer as well as the browser.

`formatShortcut` and `ariaKeyShortcuts` are exported beside the component, so a caller that needs the string rather than the element (a `title`, a tooltip, a plain-text export) gets it from the same logic.

## Prior art

Most kits ship `<kbd>` as a styled element and nothing more: the caller types the glyphs, which means every shortcut in the product is authored twice, once per platform, and usually only once in practice. This component's addition is the shortcut _model_ — one spec, two faces, canonical modifier order — and it is the reason a shortcut can be stored in data rather than baked into a template.

The two sources it answers to are specifications rather than kits. **Apple's Human Interface Guidelines** fix the modifier order as ⌃⌥⇧⌘, which is why the parser sorts rather than preserving what the author typed. **WAI-ARIA's `aria-keyshortcuts`** fixes the spoken spelling: platform-neutral key names joined with `+`, never a glyph, which is what `ariaKeyShortcuts` produces.

Where it is thinner: there is no key-binding side. The component knows how to _say_ `Mod+Shift+K` and nothing about listening for it, so the spec and the handler are two separate declarations that can drift apart with nothing to catch it. A kit that owns both would register the shortcut and render its face from the same object.

## Accessibility

The glyph run is the problem this component exists to manage: `⇧⌘K` is four characters that a screen reader has no reliable name for, and reading them aloud produces noise rather than a shortcut.

- **The spoken form is mirrored into `aria-label`** as the platform-neutral spelling, so `Mod+K` on Apple announces "Meta+K" rather than a symbol. That is the right _content_.
- **Whether `aria-label` is the right attribute is an open question.** `aria-keyshortcuts` is the attribute specified for this purpose, but it belongs on the element that _has_ the shortcut, not on the token that draws it; `aria-label` here overrides the element's text, which is what makes the glyph announceable. The consequence to watch is a `Kbd` inside a control that already names itself: the label is announced as a second string, not as part of the control's name.
- **A literal face gets no `aria-label` at all.** `ariaKeyShortcuts` returns nothing for a spec it cannot parse, because there is no honest way to spell out `⌘K` without guessing. So hand-typed shortcuts are announced as raw glyphs — one more reason to pass a spec.
- **The element is a `<kbd>`**, which is the correct semantic and carries no role of its own.
- Nothing is focusable, which is right: there is nothing here to operate.

## Theming

`--pretui-kbd-background` (falling back to `--inset`, then `--boxel-100`), `--pretui-kbd-foreground` (falling back to `--muted-foreground`), `--pretui-shadow-hairline` (falling back to a 1px ring in `--border`), `--radius-chip` (4px), `--font-mono`, `--text-ui-xs` (11px).

The 1.5em minimum width, the 1px/5px padding, `tabular-nums` and `white-space: nowrap` are fixed. The minimum width and tabular figures exist together so a column of shortcuts in a menu aligns instead of ragging.

A season retunes every shortcut in the product through the two `--pretui-kbd-*` tokens; leaving them unset means the token follows `--inset` and `--muted-foreground`, so it stays quieter than the label beside it without any per-season work. The hairline comes from the shared `--pretui-shadow-hairline`, so a season that changes ring weight changes it here too.
