## What it is

A stream of independently-authored articles the reader pages through: an activity log, a comment thread, a notifications list, a chat transcript. Use it when items arrive over time and each is a self-contained thing to read. If the sequence is fixed and historical, **Timeline** is simpler and has an `<ol>`'s numbering. If the items are uniform records with columns, **DataGrid**. If they are tiles, **Grid** or **Masonry**.

## The contract

```
@items: T[]   (T extends FeedItem: { id, label?, …})
@label? ('Activity'), @loading?, @skeletonCount? (default 2)
<:item as |item, index|>
```

**Content is a slot, not a prop bag.** Callers render their own article bodies — Law 7 of the kit. The consequence is that a Feed knows nothing about what is in it, which is why `label` exists on the item (see below).

**It is generic over `T extends FeedItem`.** `FeedItem` is a lower bound, not the item type: pass `Activity[]` and the `<:item>` block yields `Activity`, not `unknown`. The index signature is there only so an untyped fixture stays legal. Compare **Board**, which is deliberately *not* generic because its yielded value is a position rather than a record — the two decisions are the considered opposite of each other.

**`@loading` sets `aria-busy` and renders a skeleton tail**, and **the tail sits outside `role="feed"`** — a feed's children must all be articles, so putting skeletons inside would produce invalid structure. `EmptyState` covers the empty case, so a feed never has a blank frame.

## Prior art

**Activity feeds normally ship as unlabelled `<div>` soup** — that is the whole comparison set, because Radix, Web Awesome, React Spectrum and shadcn ship no feed component at all. The pattern's only real specification is APG's **Feed**.

So the interesting comparison is against APG itself, and Pretui deviates in one place deliberately:

**APG's feed example puts `tabindex="0"` on every article.** A 200-item feed is therefore 200 tab stops, and Tab stops being a way to leave the region. This feed uses a **roving tabindex** — exactly one article is in the tab sequence, Tab leaves the feed immediately, and Page Down / Page Up / Home / End move between articles.

That deviation cascades correctly: because Tab already escapes, APG's Control+Home / Control+End escape hatches become unnecessary, so **plain Home/End jump to the first and last article** instead. And they are ignored when focus sits inside a control within an article — so pressing Home in a reply box moves the caret rather than jumping the feed. That last detail is the one that separates a considered implementation from a literal one.

Where it is behind a mature feed: **no virtualisation** (200 articles are 200 rendered articles), no infinite-scroll integration (`@loading` is a flag you drive), no read/unread state, and no scroll anchoring when items are prepended.

## Accessibility

Governing pattern: APG **Feed**. This is among the best-implemented components in the kit, and the roving-tabindex deviation is an improvement on the pattern rather than a shortcut.

Present and correct: `role="feed"` with `aria-label`; `aria-busy` while loading; `role="article"` per item with `aria-posinset` and `aria-setsize`; `aria-label` on each article; a roving tabindex so the feed is one tab stop; Page Up/Page Down/Home/End between articles; and the skeleton tail excluded from the feed's children.

**`aria-label` on each article is required by the pattern**, and the component synthesises one from the item's position when `label` is omitted. That is the right fallback — an unlabelled article is announced as "article" and nothing else — but a synthesised "Item 4 of 200" is much worse than "Comment by Ada Lovelace, 3 days ago". **Always pass `label`.** It is the single highest-leverage thing a caller does here.

Gaps:

- **New items arriving are not announced.** `aria-busy` says "loading"; nothing says "12 new items". APG's feed pattern expects the author to manage this, and a `role="status"` region — existing in the DOM before the change — is the fix. It belongs to the caller and nothing prompts for it.
- **`aria-busy` on the feed suppresses announcements while true**, which is correct behaviour and means the region must be un-busied for anything inside to be announced afterwards.
- **Focus is not preserved across item prepends.** If new items are unshifted onto `@items`, `aria-posinset` values shift under the reader; there is no scroll or focus anchoring.
- **`@label` defaults to the literal `'Activity'`** — two feeds on a page are both announced identically.
- **Articles may contain their own interactive content**, and that content joins the tab sequence normally once focus is inside an article. That is correct, and it means the "one tab stop" claim is about the *articles*, not about everything in the region.
- **No `aria-describedby` linking an article to its own timestamp or author**; those are content the caller renders.

## Theming

The Feed itself paints very little — it is structure plus focus management. Consumed: `--border` or `--card` for row separation, `--text-ui-md`, and the layout spacing tokens. The loading tail is **Skeleton**'s tokens (`--inset`, `--hover`); the empty state is **EmptyState**'s (`--canvas`, `--primary`, `--font-serif`).

Almost all visual weight belongs to what you yield into `<:item>`, which is the intent: a feed of comments and a feed of build results should look nothing alike, and the component's job is the semantics they share.

The focused-article indicator is the one thing worth checking per season. Because the feed has a roving tabindex, an article *will* receive focus, and if the season paints no visible focus ring on a non-interactive `role="article"` element, a keyboard user paging with Page Down sees nothing move.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
