const BASE64_RUN = /[A-Za-z0-9+/_-]{8,}/g;

// Whether `text` carries `credential` raw, percent-encoded (either hex case),
// form-encoded, or inside any base64/base64url run at any alignment (each run
// is decoded and searched). Computed independently of the scrubber so a test
// of the scrubber can't agree with it by construction.
export function leaksCredential(text: string, credential: string): boolean {
  let percent = encodeURIComponent(credential);
  let forms = [
    credential,
    percent,
    percent.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()),
    new URLSearchParams({ k: credential }).toString().slice(2),
  ];
  if (forms.some((form) => text.includes(form))) {
    return true;
  }
  for (let run of text.match(BASE64_RUN) ?? []) {
    // A run may start mid-group; try each of the four offsets.
    for (let offset = 0; offset < 4; offset++) {
      let candidate = run.slice(offset);
      for (let encoding of ['base64', 'base64url'] as const) {
        if (
          Buffer.from(candidate, encoding)
            .toString('latin1')
            .includes(credential)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
