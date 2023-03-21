import config from '@cardstack/host/config/environment';
import { baseRealm, assetsDir } from '@cardstack/runtime-common';

const { isBaseRealmHosting } = config;
let assetPathname = new URL(`${baseRealm.url}${assetsDir}`).pathname;

// @ts-expect-error this is consumed by webpack to set the public asset path at runtime
__webpack_public_path__ = isBaseRealmHosting ? assetPathname : '/';
