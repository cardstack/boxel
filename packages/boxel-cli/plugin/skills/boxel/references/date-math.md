# Date math in Boxel cards

A surprisingly common source of wasted time. The runtime types of `DateField` / `DateTimeField` aren't well-documented, and several intuitive moves don't work.

## What the runtime gives you

```gts
@field publishedAt = contains(DateTimeField);
@field birthday = contains(DateField);
```

At runtime (inside a `computeVia` or a Component getter), `this.publishedAt` is:

- **`Date` object** for `DateField` / `DateTimeField` once the card has been loaded and deserialized.
- **`null`** if the field has never been set.
- **`string`** (ISO) when the host is serializing for save (briefly — you usually don't see this).

For computation, treat it as `Date | null` and code defensively.

## Idioms that work

### Day difference (whole days between two dates)

```gts
@field daysBetween = contains(NumberField, {
  computeVia: function(this: Trip) {
    if (!this.startDate || !this.endDate) return 0;
    const ms = this.endDate.getTime() - this.startDate.getTime();
    return Math.round(ms / 86_400_000); // 24 * 60 * 60 * 1000
  },
});
```

### "Today" in the card's wall clock

```ts
get today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
```

Note this re-evaluates each render (good — so "today" stays current). If you put `new Date()` inside a `computeVia`, it'll bind to the *indexing* time, which is wrong for "is overdue today?" checks.

### "Is overdue?" (more than N days ago)

```gts
@field isOverdue = contains(BooleanField, {
  computeVia: function(this: Task) {
    if (!this.dueAt || this.status === 'done') return false;
    const cutoff = Date.now() - 7 * 86_400_000; // 7 days
    return this.dueAt.getTime() < cutoff;
  },
});
```

Same caveat — `Date.now()` here is index-time. Acceptable for "was overdue when last indexed", not for "is overdue right now".

### Streak / consecutive days

For "consecutive days back from today through a `linksToMany(CheckIn)`":

```ts
// In a Component getter (NOT computeVia — needs `new Date()` at render).
get currentStreak(): number {
  const checkIns = this.args.model.checkIns ?? [];
  const days = new Set(
    checkIns
      .map(c => c?.date)
      .filter(Boolean)
      .map((d: Date) => d.toISOString().slice(0, 10)) // YYYY-MM-DD bucket
  );
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
```

The `toISOString().slice(0, 10)` trick gives a stable `YYYY-MM-DD` bucket key that's safe to use in a `Set`.

### Max of an array of datetimes

```ts
@field lastTouched = contains(DateTimeField, {
  computeVia: function(this: Contact) {
    const dates = (this.notes ?? [])
      .map(n => n?.createdAt)
      .filter((d): d is Date => d instanceof Date);
    if (!dates.length) return null;
    return new Date(Math.max(...dates.map(d => d.getTime())));
  },
});
```

## Idioms that DON'T work

### ❌ Template helpers inside `computeVia`

```ts
// ❌ Don't do this — formatDateTime is a Glimmer helper, not a value function
@field title = contains(StringField, {
  computeVia: function() {
    return formatDateTime(this.date); // ReferenceError at index time
  },
});
```

Format dates inside templates instead:

```hbs
{{formatDateTime @model.date size="medium"}}
```

If you absolutely need a formatted string in a `computeVia`, do it with plain Date methods:

```ts
return this.date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
```

### ❌ Inline arithmetic in templates

```hbs
{{!-- ❌ Glimmer doesn't allow operator expressions --}}
<div style="width: {{this.totalDays * 30}}px" />
```

Move math into a getter and return an `htmlSafe` string. A plain string bound to `style` is stripped by Glimmer at runtime (style bindings require a `SafeString`), and a concatenated `style='width: {{…}}px'` attribute fails lint (`no-inline-styles` + `style-concatenation`):

```ts
import { htmlSafe } from '@ember/template';

get widthStyle() { return htmlSafe(`width: ${this.totalDays * 30}px`); }
```

```hbs
<div style={{this.widthStyle}} />
```

For setting a single CSS custom property, the `cssVar` helper is lighter than a getter. See [`styling-design.md`](styling-design.md) "Dynamic inline styles".

### ❌ TypeScript thinking the value is a string

Sometimes TS infers `string` for `DateTimeField` access (depending on import chain). If the value is actually a `Date` at runtime but TS complains, cast narrowly:

```ts
const finished = this.finishedAt as unknown as Date | null;
if (finished) { /* ... */ }
```

Don't `as any` — it hides real bugs.

## Auto-refresh at midnight

There's no built-in "refresh this card when the date rolls over". `currentStreak` and similar live computations only refresh when the user interacts with the card. If you need true wall-clock liveness, that's a host-level concern (the realm doesn't re-index on schedule); accept that the streak count is "as of last render" and call it good.

## Format reference (template-side)

```hbs
{{formatDateTime @model.date size="tiny"}}    {{!-- today-aware compact date/time --}}
{{formatDateTime @model.date size="short"}}   {{!-- compact date --}}
{{formatDateTime @model.date size="medium"}}  {{!-- standard date/time --}}
{{formatDateTime @model.date size="long"}}    {{!-- detailed date/time --}}
```

Imported from `@cardstack/boxel-ui/helpers`. See `formatters.md` for the full formatter list.

## Quick check

If your computation involves `new Date()` or "right now": Component getter, not `computeVia`.
If your computation involves template formatting helpers: template, not `computeVia`.
If your computation only reads other fields and returns a primitive: `computeVia` is fine.
