## What it is

The season switcher for a documentation or catalogue surface: it applies a theme to everything inside it and yields the controls for changing which one.

It is a tool, not a product control — a real application's theme setting belongs in its own settings surface. This exists so a reader can see any component under any season.

## The contract

```
@theme?   — the Theme card linked from the page card's cardInfo
@context? — pass it to enable the season selector: the frame queries the realm
            for every Theme instance, so all shipped seasons are choosable
@bar?     — false hides the frame's own pill, for pages that place the yielded
            control in their own header instead

<:default> — yields TWO header-seatable controls:
             [collapsed popover trigger, expanded inline segmented + select]
```

**The frame owns the switching state**: the light/dark/auto mode and the selected theme id live here, defaulting to `auto`. What it does not own is _persistence_ — nothing is written to storage, so a host that wants the choice to survive a reload stores it itself.

**`@context` is the switch between one season and all of them.** Without it the frame dresses its content in `@theme` and offers only a mode toggle; with it, the frame queries the realm for every Theme instance and the season select appears.

**It yields two presentations of the same controls, and the page picks one.** The collapsed form is a single trigger opening a **Popover**; the expanded form is an inline **SegmentedControl** plus a **Select**. A page with room seats the expanded one in its own header; a cramped one takes the trigger. `@bar={{false}}` is what stops the frame drawing its own pill when you have seated a yielded control elsewhere.

## Prior art

The theme switcher in every component-documentation site.

Where Pretui is better: yielding the controls rather than only rendering them. A switcher that can only appear where the frame is drawn forces every catalogue page into the same header layout; yielding both presentations lets the page decide, and `@bar` lets it opt out of the default entirely.

Where it is thinner: no persistence, no per-component theme override, and no way to preview two seasons side by side — the frame dresses one subtree at a time.

## Accessibility

- **Mode and season are real controls** — a **SegmentedControl** and a **Select** — so both are reachable and announced, in either presentation.
- **The collapsed trigger carries the active theme's name in its title**, so what is currently applied is discoverable without opening the popover.
- **The popover is the kit's**, so light-dismiss, Escape and focus return come with it.
- **Changing season changes contrast across the whole subtree.** That is the component's purpose, and it means a catalogue can be put into a season whose tokens fail contrast — the frame applies what it is given and does not check it.
- **`auto` follows the platform**, which is the right default: a reader who has set a system preference should not have to set it again to browse a catalogue.

## Theming

The frame applies a theme rather than being themed by one — it is the component that establishes the token scope its subtree renders in, using boxel-ui's own theme helpers rather than hand-rolling the scoping.

Its own chrome takes the kit's control and overlay tokens, which means the switcher itself is dressed by whichever season is active. That is deliberate and occasionally disorienting: switching to a low-contrast season restyles the control you switched with.
