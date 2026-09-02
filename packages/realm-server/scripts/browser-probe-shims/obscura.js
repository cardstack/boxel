// Page init script for standby-boot-probe.ts --shim: the two gaps that stop
// the host booting and rendering on Obscura 0.2.1.
if (typeof document.queryCommandSupported !== 'function') {
  document.queryCommandSupported = () => false;
}
// 2. Obscura drops headers when fetch() is given a Request object or an
//    array-of-pairs headers init. Normalize both into (url, init-with-plain-
//    object-headers) before handing off to the engine's fetch.
(() => {
  let orig = globalThis.fetch;
  let toPlain = (h) => {
    let out = {};
    if (!h) return out;
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) {
        h.forEach((v, k) => {
          out[k] = v;
        });
        return out;
      }
    } catch (_e) {}
    if (Array.isArray(h)) {
      for (let [k, v] of h) out[k] = v;
      return out;
    }
    if (typeof h === 'object') {
      for (let k of Object.keys(h)) out[k] = h[k];
    }
    return out;
  };
  globalThis.__fetchShimHits = 0;
  globalThis.fetch = function (input, init) {
    if (typeof Request !== 'undefined' && input instanceof Request) {
      globalThis.__fetchShimHits++;
      let headers = {
        ...toPlain(input.headers),
        ...toPlain(init && init.headers),
      };
      let merged = { method: input.method, ...(init || {}), headers };
      let needsBody =
        merged.body === undefined &&
        input.method !== 'GET' &&
        input.method !== 'HEAD';
      if (needsBody && typeof input.text === 'function') {
        return input
          .text()
          .then((body) =>
            orig.call(globalThis, input.url, { ...merged, body }),
          );
      }
      return orig.call(globalThis, input.url, merged);
    }
    if (
      init &&
      init.headers &&
      (Array.isArray(init.headers) ||
        (typeof Headers !== 'undefined' && init.headers instanceof Headers))
    ) {
      globalThis.__fetchShimHits++;
      init = { ...init, headers: toPlain(init.headers) };
    }
    return orig.call(globalThis, input, init);
  };
})();
