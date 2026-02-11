import type ApplicationInstance from '@ember/application/instance';

// This instance initializer pre-loads card instances from shoebox data into the
// store before routing starts.  This ensures that store.peek() returns card
// instances during the first (rehydration) render so the template output
// matches the prerendered DOM and the rehydration builder can adopt it without
// triggering clearMismatch.
//
// Timing: instance initializers run BEFORE router.startRouting() inside
// ApplicationInstance._bootSync().  We monkey-patch startRouting to delay it
// until the preload promise settles, then call the original.

export function initialize(appInstance: ApplicationInstance): void {
  let shoeboxData = (globalThis as any).__boxelShoeboxData;
  if (
    !shoeboxData ||
    (globalThis as any).__boxelRenderMode !== 'rehydrate'
  ) {
    return;
  }

  let store = appInstance.lookup('service:store') as any;
  let shoeboxUrls = Object.keys(shoeboxData);

  if (shoeboxUrls.length === 0) {
    return;
  }

  // Routes use URLs like /minicatalog/ but the shoebox keys are canonical
  // (/minicatalog/index).  We must preload using the route-format URL so the
  // store registers the card under the key that peek() will be called with.
  // The fetch interceptor handles the /index fallback.
  let routeUrls = shoeboxUrls.map((url) =>
    url.endsWith('/index') ? url.slice(0, -'index'.length) : url,
  );
  let allUrls = [...new Set([...routeUrls, ...shoeboxUrls])];

  console.log(
    '[shoebox] Pre-loading',
    allUrls.length,
    'URL(s) into the store before routing',
  );

  let preloadPromise = (async () => {
    await store.ensureSetupComplete();
    await Promise.all(
      allUrls.map((url: string) =>
        store.get(url).catch((e: any) => {
          console.warn('[shoebox] Failed to preload card:', url, e);
        }),
      ),
    );
    console.log('[shoebox] Pre-load complete');
  })();

  // Delay routing until the store is populated.  The router singleton is
  // already registered; we just patch its startRouting method.
  let router = appInstance.lookup('router:main') as any;
  let originalStartRouting = router.startRouting.bind(router);
  router.startRouting = function () {
    preloadPromise
      .catch((e: any) => {
        console.error('[shoebox] Pre-load failed, starting routing anyway:', e);
      })
      .then(() => {
        // Restore original method so future calls are not affected
        router.startRouting = originalStartRouting;
        originalStartRouting();
      });
  };
}

export default {
  initialize,
};
