// Declares the vendored bundle's exports so a host or catalog card that reaches
// the dashboard type-checks. They are opaque here: internal/structure-dashboard.gts
// is the one importer, and its `GridStackStatic` / `GridStackEngineStatic` are
// the typed surface it uses.

export declare const GridStack: unknown;
export declare const GridStackEngine: unknown;
