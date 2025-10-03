export function getEnvironmentDomain(): string {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === 'production') {
    return 'boxel.site';
  }

  if (nodeEnv === 'staging') {
    return 'staging.boxel.build';
  }

  return 'boxel.dev.localhost';
}
