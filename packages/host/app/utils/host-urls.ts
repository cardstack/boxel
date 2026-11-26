import { ensureTrailingSlash } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

// A URL's host and path, which name an address whatever its scheme. The host
// builds `https://` URLs, and the realm server gives a host URL the scheme it
// is served with.
export function hostAndPath(url: string): string {
  let parsed = new URL(url);
  return `${parsed.host}${ensureTrailingSlash(parsed.pathname)}`;
}

// Host URLs are part of Host Mode v2, which the `hostModeV2` build flag
// turns on. The tools that change host URLs call this before they do work.
export function assertHostModeV2(): void {
  if (!config.featureFlags?.hostModeV2) {
    throw new Error(
      'Host URLs are not available in this build: the hostModeV2 feature flag is off. Use publish-realm and unpublish-realm instead.',
    );
  }
}
