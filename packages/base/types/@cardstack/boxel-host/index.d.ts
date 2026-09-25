// This declaration is needed to satisfy the type checker.
declare module '@cardstack/boxel-host/tools/*' {
  const mod: any;
  export default mod;
}

// Pre-rename spelling of the tools/ specifiers; resolves to the same modules.
declare module '@cardstack/boxel-host/commands/*' {
  const mod: any;
  export default mod;
}

// Host library modules card code may import, declared per module with their
// named exports so they type-check in programs that compile base without
// host sources — and without `esModuleInterop`, which rules out an `any`
// wildcard here. Programs with host sources map the
// `@cardstack/boxel-host/lib/*` prefix onto the real modules via `paths`.
declare module '@cardstack/boxel-host/lib/pdfjs-loader' {
  // Matches `loadPdfjs` in `packages/host/app/lib/pdfjs-loader.ts`.
  export function loadPdfjs(): Promise<any>;
}

declare module '@cardstack/boxel-host/lib/three-loader' {
  // Matches `loadThree` in `packages/host/app/lib/three-loader.ts`.
  export function loadThree(): Promise<{
    THREE: any;
    GLTFLoader: any;
    STLLoader: any;
    ThreeMFLoader: any;
  }>;
}

declare module '@cardstack/boxel-host/lib/signed-capture' {
  // Matches `packages/host/app/lib/signed-capture.gts`. `SignedCapture`
  // yields [signedUrl, errorMessage]; `SignedCaptureLink` renders an anchor
  // that opens its capture URL in a new tab with a fresh token.
  import type { ComponentLike } from '@glint/template';
  export const SignedCapture: ComponentLike<{
    Args: { url?: string | null };
    Blocks: { default: [string | undefined, string | undefined] };
  }>;
  export const SignedCaptureLink: ComponentLike<{
    // `kind`/`size` pass through to the shared Button (typed as string here
    // so programs without boxel-ui in their graph still check).
    Args: { url?: string | null; kind?: string; size?: string };
    Blocks: { default: [] };
    Element: HTMLButtonElement | HTMLAnchorElement;
  }>;
}
