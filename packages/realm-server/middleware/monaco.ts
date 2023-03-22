import { proxyAsset } from './index';
import Router from '@koa/router';
import compose from 'koa-compose';
import type Koa from 'koa';
import {
  baseRealm,
  assetsDir,
  Loader,
  type Realm,
} from '@cardstack/runtime-common';

const monacoFont = 'ade705761eb7e702770d.ttf';

export function monacoMiddleware(realms: Realm[]) {
  let router = new Router();
  router.get(`/${monacoFont}`, (ctxt: Koa.Context) =>
    ctxt.redirect(
      Loader.resolve(new URL(`.${ctxt.path}`, `${baseRealm.url}${assetsDir}`))
        .href
    )
  );
  return compose([
    router.routes(),
    ...(!realms.find((r) => r.url === baseRealm.url)
      ? [
          ...['editor', 'json', 'css', 'ts', 'html'].map((f) =>
            proxyAsset(`/base/__boxel/${f}.worker.js`)
          ),
        ]
      : []),
  ]);
}
