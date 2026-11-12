// Pretui — memoised Intl constructors for the components that format per
// render: money cells, relative times, date and period labels.
//
// Every Intl formatter holds ICU data outside the JavaScript heap (about
// 29 KB for an Intl.DateTimeFormat) that the garbage collector does not
// count, so a getter that builds one per render grows the renderer by that
// much for every row of a table. These build each distinct (locale, options)
// formatter once and return the same instance after that.
//
// Unlike `numberFormatter` / `dateFormatter` in reading-format, which degrade
// down a fallback ladder and never throw, these behave exactly like
// `new Intl.*`: a construction that throws is not cached and the error
// reaches the caller, whose own `catch` decides the fallback.
//
// The key covers the locale and every option, `timeZone` included. Each map
// holds up to MAX_ENTRIES formatters and then drops its oldest. The bound
// sits far above the option combinations the kit uses, so in normal use
// nothing is evicted; eviction would bring back the per-render cost.

// Per formatter type, far above the combinations the code uses. It bounds
// memory when a caller passes locales from data (one per row, say), where
// each distinct tag would otherwise keep its own formatter for the life of
// the page.
const MAX_ENTRIES = 500;

type Locales = string | readonly string[] | undefined;

function cacheKey(locales: Locales, options: object | undefined): string {
  let entries = options
    ? Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    : [];
  return JSON.stringify([locales ?? null, entries]);
}

function memoise<F, O extends object>(
  build: (locales: Locales, options: O | undefined) => F,
): (locales?: Locales, options?: O) => F {
  let cache = new Map<string, F>();
  return (locales, options) => {
    let key = cacheKey(locales, options);
    let formatter = cache.get(key);
    if (formatter === undefined) {
      formatter = build(locales, options);
      if (cache.size >= MAX_ENTRIES) {
        // Drop the oldest entry. Only a caller feeding in an unbounded set of
        // locales or options reaches this; the code's own combinations are
        // far fewer.
        cache.delete(cache.keys().next().value as string);
      }
      cache.set(key, formatter);
    }
    return formatter;
  };
}

export const cachedNumberFormat = memoise<
  Intl.NumberFormat,
  Intl.NumberFormatOptions
>((locales, options) => new Intl.NumberFormat(locales, options));

export const cachedDateTimeFormat = memoise<
  Intl.DateTimeFormat,
  Intl.DateTimeFormatOptions
>((locales, options) => new Intl.DateTimeFormat(locales, options));

export const cachedRelativeTimeFormat = memoise<
  Intl.RelativeTimeFormat,
  Intl.RelativeTimeFormatOptions
>((locales, options) => new Intl.RelativeTimeFormat(locales, options));

export const cachedListFormat = memoise<
  Intl.ListFormat,
  Intl.ListFormatOptions
>((locales, options) => new Intl.ListFormat(locales, options));
