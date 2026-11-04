// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports NodeCanvas type-checks. Only what Pret UI uses;
// node, edge and change values stay opaque, as the engine documents them.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ComponentLike } from '@glint/template';

type Vendored<Blocks = Record<string, never>> = ComponentLike<{
  Args: Record<string, any>;
  Blocks: Blocks;
  Element: HTMLElement;
}>;

export declare const Background: Vendored;
export declare const Canvas: Vendored<{ default: [store: any] }>;
export declare const Controls: Vendored;
export declare const Handle: Vendored;
export declare const MiniMap: Vendored;
export declare const Panel: Vendored<{ default: [] }>;

export declare function getCanvas(
  owner: object,
  options: { nodes: () => readonly unknown[]; edges: () => readonly unknown[] },
): unknown;
export declare function applyNodeChanges<T>(
  changes: unknown[],
  nodes: T[],
): T[];
export declare function applyEdgeChanges<T>(
  changes: unknown[],
  edges: T[],
): T[];
export declare function addEdge<T>(connection: unknown, edges: T[]): T[];
