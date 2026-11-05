// How a key's anonymous caps read wherever the window describes them: calls a
// UTC day and a UTC month across everyone who isn't signed in, in every
// workspace the key is shared into. A key can have either, both or neither.
export interface AnonymousCaps {
  anonymousDailyCap: number | null;
  anonymousMonthlyCap: number | null;
}

// "100 calls a day and 1000 a month", or undefined for a key with no cap.
// `short` leaves out "calls", for a list that already says what is counted.
export function anonymousCapsPhrase(
  { anonymousDailyCap: daily, anonymousMonthlyCap: monthly }: AnonymousCaps,
  { short = false } = {},
): string | undefined {
  let calls = short ? '' : ' calls';
  if (daily != null && monthly != null) {
    return `${daily}${calls} a day and ${monthly} a month`;
  }
  if (daily != null) {
    return `${daily}${calls} a day`;
  }
  if (monthly != null) {
    return `${monthly}${calls} a month`;
  }
  return undefined;
}

// The caps as the end of a sentence about people who aren't signed in:
// ", up to 100 calls a day and 1000 a month all together", or nothing, as
// for no key at all.
export function anonymousCapsClause(key: AnonymousCaps | undefined): string {
  let phrase = key ? anonymousCapsPhrase(key) : undefined;
  return phrase ? `, up to ${phrase} all together` : '';
}
