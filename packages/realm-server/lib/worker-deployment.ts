import { isDeployedServerURL } from './outbound/client.ts';

export function workerIsDeployed(
  mappings: [URL | string, URL][],
  localServerURL: string | undefined,
): boolean {
  if (localServerURL === undefined) {
    return mappings.some(([, to]) => isDeployedServerURL(to.href));
  }
  let server = new URL(localServerURL);
  if (
    !['http:', 'https:'].includes(server.protocol) ||
    server.username ||
    server.password ||
    server.search ||
    server.hash ||
    isDeployedServerURL(server.href) ||
    !mappings.some(
      ([from, to]) =>
        from instanceof URL &&
        from.origin === server.origin &&
        !isDeployedServerURL(to.href),
    )
  ) {
    throw new Error(
      'Local worker identity must match a locally served realm mapping',
    );
  }
  return false;
}
