import config from '@cardstack/host/config/environment';

const { hostsOwnAssets, assetsURL } = config;

// @ts-expect-error this is consumed by webpack to set the public asset path at runtime
__webpack_public_path__ = hostsOwnAssets ? '/' : assetsURL;
