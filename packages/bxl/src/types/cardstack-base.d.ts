// Ambient declaration so the BXL realm bundle can import directly from
// the Boxel runtime URL. The realm server resolves the URL at request
// time; the build script (scripts/build-realm-bundle.mjs) marks https://*
// imports as external so esbuild leaves the statement in the output.

declare module 'https://cardstack.com/base/card-api' {
  export function getFields(
    instance: unknown,
    options?: { includeComputeds?: boolean },
  ): Record<
    string,
    { fieldType?: string; card?: unknown; computeVia?: Function }
  >;
}
