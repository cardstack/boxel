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
