// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports Sheet type-checks. Only what Pret UI uses; Sheet
// narrows the engine's sheet to its own `EngineSheet`.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ComponentLike } from '@glint/template';

type Vendored<Blocks> = ComponentLike<{
  Args: Record<string, any>;
  Blocks: Blocks;
  Element: HTMLElement;
}>;

export declare const Grid: Vendored<{ header: [grid: any]; body: [grid: any] }>;
export declare const Row: Vendored<{ default: [] }>;
export declare const Cell: Vendored<Record<string, never>>;

export declare function getSheet(owner: object, options: object): unknown;
