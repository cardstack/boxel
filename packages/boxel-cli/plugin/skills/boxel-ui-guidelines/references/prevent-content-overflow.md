## Prevent Content Overflow

Content must never overflow its container. Always write CSS defensively for small viewports.

- Use `overflow: hidden` or `boxel-ellipsize` class name on text that could overflow
- Use `gap` instead of margins between flex/grid items to avoid blowout
- Avoid fixed `width` or `height` values that ignore the available space; use `min-*` / `max-*` variants or relative units instead
