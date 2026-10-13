// The card-facing doorway to the host's vendored three.js: a zero-cost
// function whose call performs the lazy chunk load (see `./three` for what
// the chunk exports). It exists as a real module — not only a virtual-
// network shim id — because host-bundled copies of card code (test builds
// import base source directly) resolve the specifier through the bundler,
// while loader-served card code reaches it through the `shimModule`
// registration in `externals.ts`. Both paths land here.
export async function loadThree(): Promise<{
  THREE: any;
  DRACOLoader: any;
  GLTFLoader: any;
  RectAreaLightUniformsLib: any;
  STLLoader: any;
  ThreeMFLoader: any;
}> {
  let {
    THREE,
    DRACOLoader,
    GLTFLoader,
    RectAreaLightUniformsLib,
    STLLoader,
    ThreeMFLoader,
  } = await import('./three.js');
  return {
    THREE,
    DRACOLoader,
    GLTFLoader,
    RectAreaLightUniformsLib,
    STLLoader,
    ThreeMFLoader,
  };
}
