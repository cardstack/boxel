---
validated: source-proven
---

# link-onclick-outside — Canonical `onClickOutside` modifier

**What this gives you:** A Glimmer modifier you attach to a popover / menu / dialog that fires a callback when the user clicks anywhere *outside* the element. The catalog ships this identically in two places — promote it to a shared utility in your realm.

**When to use:** Any dropdown, popover, dialog, or floating UI that should dismiss on outside click. Inline editors that should commit on blur.

**The insight:** The 50ms `setTimeout` before attaching the listener is the critical gotcha — without it, the same mousedown that *opened* the popover also closes it (the listener catches the click before the popover finishes mounting). Once delayed, the modifier listens at `document` level for any `mousedown`, checks the path with `element.contains(event.target)`, and calls back when it lands outside.

**Recipe shape:**

```ts
import { modifier } from 'ember-modifier';

const onClickOutside = modifier((element: HTMLElement, positional: unknown[]) => {
  const callback = positional[0] as () => void;
  const handler = (event: MouseEvent) => {
    if (!element.contains(event.target as Node)) callback();
  };
  // Delay attaching so the click that opened us isn't caught.
  const timer = setTimeout(() => {
    document.addEventListener('mousedown', handler);
  }, 50);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', handler);
  };
});
```

Usage:
```hbs
{{#if this.isOpen}}
  <div class='popover' {{onClickOutside (fn this.close)}}>…</div>
{{/if}}
```

**Gotchas:**
- Use `mousedown` not `click` — click fires too late (after the popover has already been removed in some race conditions).
- The element must exist in the DOM before the modifier runs, so conditional rendering with `{{#if}}` works correctly.
- The cleanup return is essential — without it, a popover that's destroyed without firing the callback leaks the listener.
- If you ESC-close, also call your `close()` directly from a keydown listener — `onClickOutside` only handles mouse.

**Source:** `boxel-catalog/blog-app/blog-app.gts:13-30`, `boxel-catalog/blog-app/components/editable-field.gts:7-23` (identical implementation in both — strong signal to promote).

**See also:** `boxel/references/external-libraries.md` (modifier patterns generally).
