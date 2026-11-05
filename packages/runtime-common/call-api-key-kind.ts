// The kinds of key a `callApi` credential slot can be filled with:
//
//   * `static` — a key or token the user copies from the service and pastes,
//     sent as it is;
//   * `google-service-account` — a Google service account's JSON key file,
//     from which the realm server mints the access tokens it sends;
//   * `oauth` — an account the user connects through a sign-in app, whose
//     access tokens the realm server mints.
export const CALL_API_KEY_KINDS = [
  'static',
  'google-service-account',
  'oauth',
] as const;

export type CallApiKeyKind = (typeof CALL_API_KEY_KINDS)[number];

export function isCallApiKeyKind(value: unknown): value is CallApiKeyKind {
  return (CALL_API_KEY_KINDS as readonly unknown[]).includes(value);
}

// The kind of slot a stored key fills, by the key's own kind: an OAuth
// connection, or an OAuth client that gets its own tokens, fills an `oauth`
// slot. Undefined for a kind no slot takes. The secure origin's approve page
// keeps a copy (`slotKindOfKey` in `approval-batch.ts`), since it can't import
// runtime-common; the two must agree, or the page offers keys approval
// refuses.
export function slotKindOfKey(keyKind: string): CallApiKeyKind | undefined {
  switch (keyKind) {
    case 'static':
    case 'google-service-account':
      return keyKind;
    case 'oauth-connection':
    case 'oauth-client':
      return 'oauth';
    default:
      return undefined;
  }
}

// Whether a stored key of `keyKind` may fill a slot whose declaration names
// `declared`. A slot that declares no kind takes any key that can be sent.
export function keyFitsSlot(
  keyKind: string,
  declared: CallApiKeyKind | undefined,
): boolean {
  return declared === undefined || slotKindOfKey(keyKind) === declared;
}
