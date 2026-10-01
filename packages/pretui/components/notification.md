## What it is

A **persistent notification item**: a title, a message, a tone, one inline action and a dismiss button. It stays until someone dismisses it. Use it for the entries in a notification centre, an inbox panel or an activity feed, or for a banner-sized notice that must wait to be acknowledged.

It wears the same face as a **Toaster** item: the tone stripe, the title and message, the inline action and the dismiss button. A toast that ages out and the notification it leaves behind therefore read as the same object. How it differs from its neighbours:

- **Toaster** stacks transient items and dismisses them on a clock. Notification has no clock.
- **Toast** is the slimmer card with no tone and no dismiss button.
- **Alert** is an inline message about the content it sits next to, with no dismiss button.
- **Snackbar** is the alias Material agents type for a toast.

## The contract

```
@title, @message? (alias @description)
@tone? ('neutral' | 'info' | 'success' | 'warning' | 'danger', plus the kit's tone spellings; default 'neutral')
@busy?, @live?
@actionLabel?, @onAction?
@onDismiss?, @dismissLabel? (default 'Dismiss')
<:icon>     — a leading icon, tinted with the tone
<:default>  — the message, when it needs markup
<:action>   — replaces the inline action
Element: HTMLDivElement
```

**The tone paints one stripe.** As in Toaster, the 3px leading stripe is the only place a tone shows, plus the inline action's ink and the icon's tint. A neutral notification is genuinely neutral, and a list of them does not turn into a wall of colour. Unknown tones fall back to neutral.

**Announcing is opt-in.** A notification in a list is content, not news, and a centre that announces every row it renders is unusable. `@live={{true}}` makes it a live region when it appears: `role="alert"` with `aria-live="assertive"` for warning and danger, and `role="status"` with `aria-live="polite"` otherwise. It uses the same politeness rule as Toaster, from the same function.

**Dismiss exists when it can do something.** The dismiss button renders only when `@onDismiss` is passed. The caller owns the list, so the caller removes the item.

`@busy` swaps the icon for a spinner while the reported work is still running, such as an upload or an export, and sets `aria-busy` on the item. `@actionLabel` with `@onAction` renders one text button. The `<:action>` block takes a link or several controls instead.

## Prior art

**Mantine Notification** is the visual model: `title`, `children`, `color`, `icon`, `loading`, `withCloseButton` and `onClose`. **Ant `notification.open`** is an imperative host with `message`, `description`, `btn`, `duration` and `placement`. **MUI SnackbarContent** is the body of a Snackbar: `message` and `action`. **Sonner** toasts in shadcn take `description`, `action` and `cancel`.

Where Pretui is better: **it is not announced by default.** Mantine's Notification is `role="alert"` unconditionally, so a panel of ten renders ten alerts. **Politeness follows severity** when it is announced, which none of the above do for a standalone item. **One face for toast and notification** means the transient and persistent forms cannot drift apart. **The dismiss button is always named**, with `@dismissLabel` for a more specific name.

Where it is thinner: **no imperative API.** There is no `notification.open()`. Render it yourself, or use **Toaster**'s `ToastStore` for the transient case. There is **no timestamp or avatar slot**; put them in `<:default>`. **No read / unread state**: a notification centre's unread styling is the caller's.

## Accessibility

No APG pattern. A notification is text, one or two buttons and an optional live region.

- **It is not a live region by default.** The tests assert that a danger notification without `@live` carries no `role` and no `aria-live`.
- **With `@live`, politeness follows the tone.** Success is `role="status"` with `aria-live="polite"`, and danger is `role="alert"` with `aria-live="assertive"`. `aria-atomic="true"` makes the whole item read as one message. The tests assert both pairs. A live region only announces changes after it is in the page, so mount the item into an existing container rather than expecting its first render to be heard everywhere. **Toaster** handles that for transient items.
- **`@busy`** sets `aria-busy="true"`. The spinner is hidden and adds no second status, which the tests assert.
- **The dismiss button is a real `<button>` with an accessible name**, "Dismiss" by default. The tests assert the name and that it exists only with `@onDismiss`. On a coarse pointer its hit area grows to 44px without growing the glyph.
- **The inline action is a `type="button"`**, so a notification inside a form never submits it.
- **Tone is not the message.** The stripe backs up the title. "Payment failed" must say so in words.

## Theming

`--pretui-notification-tone` (set from the tone: `--pretui-info`, `--success`, `--warning`, `--destructive` or `--muted-foreground`), `--pretui-notification-width` (the maximum width, default 26rem), `--popover`, `--popover-foreground`, `--muted-foreground`, `--foreground`, `--primary` (a neutral item's action), `--radius-surface`, `--radius-control`, `--pretui-shadow-raised`, `--ring`, `--hover`, `--font-sans`, `--text-ui-md`, `--text-ui-sm`, `--space-3` and `--space-4`.

These are the tokens a **Toaster** item reads, so a season that retunes toasts retunes notifications the same way. The 3px stripe and the 1.25rem dismiss button are fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                       | Give them                                                |
| ------------------------------------------------- | -------------------------------------------------------- |
| Mantine `<Notification title color onClose>`      | `@title` + `@tone` + `@onDismiss`                        |
| Mantine `loading`                                 | `@busy`                                                  |
| Ant `notification.open({ message, description })` | render `@title` + `@message`, or **Toaster**             |
| MUI `<SnackbarContent message action>`            | `@title` + `<:action>`                                   |
| Sonner `toast('…', { description, action })`      | **Toaster**'s `ToastStore`; this for the persistent copy |
