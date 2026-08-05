let codeMirrorContextPromise:
  | Promise<typeof import('@cardstack/host/lib/codemirror-context')>
  | undefined;

export async function loadCodeMirror() {
  codeMirrorContextPromise ??=
    // @ts-expect-error dynamic import resolved by Ember's build pipeline
    import('@cardstack/host/lib/codemirror-context');
  return (await codeMirrorContextPromise).default;
}

export async function loadKatex() {
  let mod = await import('katex');
  return mod.default;
}

let trustedUIRenderListeners = new Set<() => void>();
let mermaidPromise: Promise<(typeof import('mermaid'))['default']> | undefined;

export function subscribeToTrustedUIRender(listener: () => void) {
  trustedUIRenderListeners.add(listener);
  return () => trustedUIRenderListeners.delete(listener);
}

export async function loadMermaid() {
  mermaidPromise ??= import('mermaid').then((mod) => {
    let mermaid = mod.default;
    let render = mermaid.render.bind(mermaid);
    mermaid.render = async (...args) => {
      let result = await render(...args);
      // Existing deployed Base templates assign their tracked SVG state only
      // after this promise resolves. Notify Host-owned render roots on the
      // following task so their continuation has published that state first.
      setTimeout(() => {
        for (let listener of trustedUIRenderListeners) {
          listener();
        }
      }, 0);
      return result;
    };
    return mermaid;
  });
  return await mermaidPromise;
}

// Existing cards import the deployed Base modules. Those modules predate the
// explicit CardContext.trustedUI capability and discover these Host-owned
// libraries through the compatibility globals below. Install them for the
// lifetime of the app (rather than a route instance) so HMR and route teardown
// cannot briefly strand a trusted editor without its loader.
export function installTrustedUIGlobals() {
  if (typeof globalThis === 'undefined') {
    return;
  }
  let globals = globalThis as typeof globalThis & {
    __loadCodeMirror?: typeof loadCodeMirror;
    __loadKatex?: typeof loadKatex;
    __loadMermaid?: typeof loadMermaid;
  };
  globals.__loadCodeMirror = loadCodeMirror;
  globals.__loadKatex = loadKatex;
  globals.__loadMermaid = loadMermaid;
}

installTrustedUIGlobals();
