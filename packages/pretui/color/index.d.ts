// Declares the vendored bundle's exports so a host or catalog card that imports
// a colour component type-checks. They are opaque here: color-engine.ts is the
// one importer, and its `Engine` interface is the typed surface it uses.

export declare const ColorSpace: unknown;
export declare const parse: unknown;
export declare const to: unknown;
export declare const serialize: unknown;
export declare const inGamut: unknown;
export declare const toGamut: unknown;
export declare const deltaE: unknown;
export declare const contrastWCAG21: unknown;
export declare const getLuminance: unknown;
export declare const mix: unknown;
