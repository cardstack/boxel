import { proxyAsset } from './index';
import Router from '@koa/router';
import compose from 'koa-compose';
import type Koa from 'koa';
import { assetsDir } from '@cardstack/runtime-common';

const monacoFont = 'ade705761eb7e702770d.ttf';

export function monacoMiddleware(assetsURL: URL) {
  let router = new Router();
  router.get(`/${monacoFont}`, (ctxt: Koa.Context) =>
    ctxt.redirect(new URL(`.${ctxt.path}`, assetsURL).href),
  );
  return compose([
    router.routes(),
    ...['editor', 'json', 'css', 'ts', 'html'].map(
      (f) => proxyAsset(`/${assetsDir}${f}.worker.js`, assetsURL), // TODO: without worker, what do we do?
    ),
  ]);
}
