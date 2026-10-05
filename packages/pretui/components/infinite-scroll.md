## What it is

**Append the next page as the reader nears the end of the list.** It is the behaviour, not the scene: wrap any list, and it asks for more when the end comes into view. **Feed** is a whole social stream built on the idea. **Pagination** is the alternative when readers need to jump to a page.

## The contract

```
@onLoadMore?, @hasMore? (default true), @busy?
@auto? (default true), @rootMargin? (default '0px 0px 200px 0px')
@loadLabel? (default 'Load more'), @loadedMessage?
<:default>  — the list
<:end>      — shown when there is nothing more
Element: HTMLDivElement
```

**The sentinel.** A 1px `aria-hidden` sentinel follows the content. An IntersectionObserver rooted at the nearest scroll container (the pane, not the window) calls `@onLoadMore` when the sentinel comes within `@rootMargin`. It stops watching while `@busy` and once `@hasMore` is false. `@auto={{false}}` keeps only the button.

**The button is always there.** A real Load more button follows the list whenever there is more. It is the path for keyboard and switch users, for a pane that never scrolls, and for when the observer can't run. It does nothing while `@busy`, and shows a spinner. When the last page lands and the button goes away, focus moves from it to the end of the list, which takes focus, instead of falling to the page.

**The caller owns the data.** `@onLoadMore` only asks. Append the page to what you render, set `@busy` while it loads, and set `@loadedMessage` ("Loaded 20 more lots") once it lands. That message is spoken through one polite status line. When `@hasMore` turns false, the `<:end>` block replaces the button.

## Prior art

**Ant `List`** takes `loadMore` (a node, usually a button). **react-infinite-scroll-component** takes `next`, `hasMore`, `loader`, `endMessage` and `scrollableTarget`. **TanStack Virtual** with a sentinel is the heavier pattern for very long lists. **Mantine** has none.

Where Pretui is better: **a button is always rendered**, so the rest of the list is always reachable without scrolling. **Progress is announced.** **The observer is pane-local**: react-infinite-scroll-component defaults to the window unless given `scrollableTarget`.

Where it is thinner: **no virtualisation.** Every loaded row stays in the DOM, so pair it with windowing for thousands of rows. There is **no loading upward** for chat-style history, and **no pull-to-refresh**.

## Accessibility

No APG pattern. It is a list, a sentinel, a button and a status line.

- **`aria-busy`** on the region follows `@busy`, which the tests assert.
- **The sentinel is `aria-hidden`**, which the tests assert.
- **The Load more button** is a real button, named by `@loadLabel`. It is ignored while busy, and it is removed at the end. The tests assert all three.
- **One polite status** (`role="status"`) carries `@loadedMessage`, which the tests assert.
- **New rows arrive after the focused element**, so focus is not disturbed. After pressing the button, focus stays on it, ready for the next page.

## Theming

`--space-4` (the foot's padding), `--muted-foreground` and `--text-ui-sm` (the end message). The button and spinner read **Button**'s and **Spinner**'s own tokens.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                        | Give them                                   |
| -------------------------------------------------- | ------------------------------------------- |
| react-infinite-scroll-component `next` / `hasMore` | `@onLoadMore` / `@hasMore`                  |
| `endMessage`                                       | `<:end>`                                    |
| `scrollableTarget`                                 | the nearest scroll container, found for you |
| Ant `<List loadMore={<Button>}>`                   | the built-in Load more button               |
| an IntersectionObserver `useEffect`                | `<InfiniteScroll>`                          |
