// Hand-written types for the vendored bundle in this directory, so the lean
// entry type-checks against its documented API rather than against whatever
// TypeScript infers from minified output. Keep in sync with README.md's export
// list. Marks are opaque values passed straight back into `plot()`.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Mark = any;
export type MarkData = readonly unknown[] | Iterable<unknown> | null | undefined;
export type MarkOptions = Record<string, any>;
/** every mark takes `(data, options)`; grid, axis and rule marks also take `(options)` alone */
type MarkFn = (dataOrOptions?: MarkData | MarkOptions, options?: MarkOptions) => Mark;

export declare const areaY: MarkFn;
export declare const axisX: MarkFn;
export declare const axisY: MarkFn;
export declare const barX: MarkFn;
export declare const barY: MarkFn;
export declare const cell: MarkFn;
export declare const dot: MarkFn;
export declare const frame: (options?: MarkOptions) => Mark;
export declare const gridX: MarkFn;
export declare const gridY: MarkFn;
export declare const line: MarkFn;
export declare const lineY: MarkFn;
export declare const rectY: MarkFn;
export declare const ruleY: MarkFn;
export declare const waffleY: MarkFn;
/** a transform: (outputs, options) → options with the binning applied */
export declare function binX(outputs?: MarkOptions, options?: MarkOptions): MarkOptions;
/** renders the figure; needs `document` */
export declare function plot(options?: MarkOptions): SVGSVGElement | HTMLElement;
