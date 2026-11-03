// Whether text is a Google service account's JSON key file. A key file is
// entered as a service account, never pasted where a key sent as it is goes:
// sent as it is, it would hand the private key to the API, and the realm
// server refuses it there.
export function isServiceAccountKeyFile(text: string): boolean {
  if (!text.trimStart().startsWith('{')) {
    return false;
  }
  try {
    let parsed = JSON.parse(text);
    return Boolean(parsed) && parsed.type === 'service_account';
  } catch {
    return false;
  }
}

// Whether a request goes to one of Google's APIs, where a service account is
// one way in; the user may have a plain API key for it instead.
export function isGoogleAPIHost(host: string | undefined): boolean {
  return (
    host === 'googleapis.com' || Boolean(host?.endsWith('.googleapis.com'))
  );
}
