// Removes credentials from text before it is recorded or returned. Every value
// the outbound client attaches to a request is registered here, along with
// each form it was attached in (e.g. `Bearer <key>`), and anything that may
// quote the request — an error, a log line, a vendor's error body — passes
// through `scrubText` first.
//
// Each registered value is matched raw and in the encodings a request or an
// error message is likely to carry it in: percent-encoding in both hex cases,
// form encoding, base64 and base64url at every alignment, and JSON string
// escapes.

export const REDACTED = '[REDACTED]';

// A base64 fragment shorter than this is too likely to occur by chance in
// unrelated text to be worth removing.
const MIN_ENCODED_FRAGMENT_LENGTH = 8;

function lowercasePercentHex(encoded: string): string {
  return encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}

// The characters of `value`'s base64 encoding that depend on `value` alone,
// when it starts `offset` bytes into a longer encoded string. Every alignment
// is needed because a credential embedded in a larger payload (an HTTP Basic
// pair, a JSON document) rarely starts on a three-byte boundary.
function base64Fragments(value: Buffer): string[] {
  let fragments: string[] = [];
  for (let offset = 0; offset < 3; offset++) {
    let encoded = Buffer.concat([Buffer.alloc(offset), value]).toString(
      'base64',
    );
    let start = Math.ceil((offset * 8) / 6);
    let end = Math.floor(((offset + value.length) * 8) / 6);
    let fragment = encoded.slice(start, end);
    if (fragment.length >= MIN_ENCODED_FRAGMENT_LENGTH) {
      fragments.push(fragment);
      fragments.push(fragment.replace(/\+/g, '-').replace(/\//g, '_'));
    }
  }
  return fragments;
}

export function encodedForms(value: string): string[] {
  let forms = new Set<string>([value]);
  let percent = encodeURIComponent(value);
  forms.add(percent);
  forms.add(lowercasePercentHex(percent));
  let form = new URLSearchParams([['', value]]).toString().slice(1);
  forms.add(form);
  forms.add(lowercasePercentHex(form));
  forms.add(JSON.stringify(value).slice(1, -1));
  for (let fragment of base64Fragments(Buffer.from(value, 'utf8'))) {
    forms.add(fragment);
  }
  return [...forms].filter(Boolean);
}

export class CredentialScrubber {
  // Longest first, so a form that contains another is removed whole rather
  // than leaving the remainder behind.
  #forms: string[] = [];

  register(value: string): void {
    if (!value) {
      return;
    }
    let forms = new Set([...this.#forms, ...encodedForms(value)]);
    this.#forms = [...forms].sort((a, b) => b.length - a.length);
  }

  get isEmpty(): boolean {
    return this.#forms.length === 0;
  }

  scrubText(text: string): string {
    let result = text;
    for (let form of this.#forms) {
      if (result.includes(form)) {
        result = result.split(form).join(REDACTED);
      }
    }
    return result;
  }
}
