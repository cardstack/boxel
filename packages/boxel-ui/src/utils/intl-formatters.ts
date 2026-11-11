// Shared, memoised Intl formatters.
//
// Every Intl formatter holds ICU data outside the JavaScript heap (about
// 29 KB for an Intl.DateTimeFormat). The garbage collector does not count
// that memory, so it feels no pressure to reclaim it, and a helper that
// builds a formatter per call grows the renderer by that much for every row
// of every render. Each function here builds a formatter once per distinct
// (locale, options) pair and hands the same instance back after that.
//
// The key covers the locale and every option, `timeZone` included, so two
// calls share a formatter only when Intl would build identical ones. The
// maps are not capped: the key space is the set of option combinations the
// code actually uses, which is small, and evicting would bring back the
// per-call construction cost.
//
// A construction that throws (a malformed locale, an unknown currency) is
// not cached and the error reaches the caller, exactly as `new Intl.*` would.

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

export const cachedPluralRules = memoise<
  Intl.PluralRules,
  Intl.PluralRulesOptions
>((locales, options) => new Intl.PluralRules(locales, options));

export const cachedDisplayNames = memoise<
  Intl.DisplayNames,
  Intl.DisplayNamesOptions
>(
  (locales, options) =>
    new Intl.DisplayNames(locales, options as Intl.DisplayNamesOptions),
);
