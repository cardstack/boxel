/* eslint-env browser */
// A response from the Matrix server goes to the app with every password
// typed into the fields cut out of it, so a server that echoed one back, in
// an error message say, couldn't hand it over. A successful response's
// session fields are the session the app is there to receive, and are left
// as they are: a password can be part of a Matrix ID or a server name
// without the server having echoed anything.
const SESSION_FIELDS = new Set([
  'user_id',
  'access_token',
  'device_id',
  'home_server',
  'well_known',
]);

export function redactResponse(result, secrets) {
  let clean = (value) => {
    if (typeof value === 'string') {
      return secrets.reduce(
        (text, secret) => text.split(secret).join('[redacted]'),
        value,
      );
    }
    if (Array.isArray(value)) {
      return value.map(clean);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, clean(item)]),
      );
    }
    return value;
  };
  let { body, ...rest } = result;
  let cleanBody =
    result.ok && body && typeof body === 'object' && !Array.isArray(body)
      ? Object.fromEntries(
          Object.entries(body).map(([key, item]) => [
            key,
            SESSION_FIELDS.has(key) ? item : clean(item),
          ]),
        )
      : clean(body);
  return { ...clean(rest), body: cleanBody };
}
