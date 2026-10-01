/**
 * The one host hook the engine glue needs: "run this after the current render pass has committed to the
 * DOM" — React's useEffect slot. The Ember adapter ({{motion}}) installs the runloop's afterRender; another
 * host (a SES-capsuled renderer, a test) installs its own.
 */
type PostRender = (fn: () => void) => void;

let impl: PostRender | undefined;

export function setPostRender(fn: PostRender) {
  impl = fn;
}

export function postRender(fn: () => void) {
  if (!impl) {
    throw new Error(
      'motion: no postRender scheduler installed (import the host adapter first)',
    );
  }
  impl(fn);
}
