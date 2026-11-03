export function createRealmServerTransport(configuration: {
  identityURL: string;
  transportURL: string;
}) {
  let identityURL = normalizeServerURL(configuration.identityURL);
  let transportURL = normalizeServerURL(configuration.transportURL);

  return {
    normalizeServerURL(value: string): string {
      let normalized = normalizeServerURL(value);
      return normalized === identityURL ? transportURL : normalized;
    },
  };
}

function normalizeServerURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid realm server URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid realm server URL');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
