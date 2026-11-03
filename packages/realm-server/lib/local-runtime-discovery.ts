export function createLocalRuntimeDiscovery(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (
    env.BOXEL_NATIVE_RUNTIME_URL === undefined &&
    env.BOXEL_NATIVE_MATRIX_PUBLIC_URL === undefined
  )
    return null;
  const controlURL = new URL(env.BOXEL_NATIVE_RUNTIME_URL ?? '');
  const matrixURL = new URL(env.BOXEL_NATIVE_MATRIX_PUBLIC_URL ?? '');
  if (
    controlURL.protocol !== 'http:' ||
    controlURL.hostname !== '127.0.0.1' ||
    controlURL.pathname !== '/' ||
    controlURL.username ||
    controlURL.password ||
    controlURL.search ||
    controlURL.hash ||
    matrixURL.protocol !== 'http:' ||
    !matrixURL.hostname.endsWith('.boxel.localhost') ||
    matrixURL.pathname !== '/' ||
    matrixURL.username ||
    matrixURL.password ||
    matrixURL.search ||
    matrixURL.hash
  )
    throw new Error('Invalid native runtime discovery configuration');
  return {
    schemaVersion: 1,
    controlURL: controlURL.href,
    matrixURL: matrixURL.href,
  };
}
