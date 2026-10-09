## What it is

The theme previewer for a documentation or catalog surface: it applies a theme to everything inside it, light or dark, and yields the controls for changing them.

It is a tool, not a product control — a real application's theme setting belongs in its own settings surface. This exists so a reader can see any component under any theme in the realm, in both modes.

## The contract

```
@theme?   — the Theme card linked from the page card's cardInfo
@context? — pass it to enable the theme selector: the frame queries the realm
            for every Theme instance, so each one can be previewed
@bar?     — false hides the frame's own bar, for pages that place the yielded
            controls in their own header instead

<:default> — yields the controls: the dark mode switch, and the theme select
             when the realm has more than one theme
```

**The mode switch is the one Boxel's ThemeDashboard uses**: a boxel-ui **Switch** labeled "Dark mode", with sun and moon icons. Off stamps `data-theme='light'` on the frame and on stamps `data-theme='dark'`, so the theme's light or dark variables apply through the same `--boxel-color-scheme` signal the host uses.

**The frame owns the switching state**: the mode and the selected theme id live here, starting light like ThemeDashboard. The Boxel chrome around the frame has fixed colors, so the switch previews dark mode rather than following the reader's system setting. What it does not own is _persistence_ — nothing is written to storage, so a host that wants the choice to survive a reload stores it itself.

**`@context` is the switch between one theme and all of them.** Without it the frame dresses its content in `@theme` and offers only the mode switch and the theme's name; with it, the frame queries the realm for every Theme instance, and when it finds more than one, a **Select** replaces the name.

**`@bar={{false}}`** stops the frame drawing its own bar when the page seats the yielded controls in its own header.

## Prior art

The theme switcher in every component-documentation site, and Boxel's own ThemeDashboard, whose mode switch this reuses.

Where it is thinner: no persistence, no per-component theme override, and no way to preview two themes side by side — the frame dresses one subtree at a time.

## Accessibility

- **The mode switch is a native checkbox with `role='switch'`**, named "Dark mode", so it is reachable, announced with its on/off state, and toggled with Space or Enter.
- **The theme select is named "Theme".**
- **Changing theme changes contrast across the whole subtree.** That is the component's purpose, and it means a catalog can be put into a theme whose tokens fail contrast — the frame applies what it is given and does not check it.

## Theming

The frame applies a theme rather than being themed by one — it establishes the token scope its subtree renders in, using boxel-ui's own theme helpers rather than hand-rolling the scoping.

Its own controls take the active theme's tokens, so the switch and select restyle with the theme they switch to.

The island paints its own surface, `--background` with `--foreground` in `--font-sans`, because its tokens flip below the card's own surface and the card's would otherwise show through. It grows to fill the frame. The controls are a group named "Theme preview"; the theme's name, when shown, is `--muted-foreground`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
