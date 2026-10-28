// Hand-written types for the vendored bundle in this directory, so a host or
// catalog card that imports PageScaffold type-checks. Only what Pret UI uses.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ComponentLike } from '@glint/template';

export declare const Layout: ComponentLike<{
  Args: { preset?: string; [arg: string]: any };
  Blocks: { default: [] };
  Element: HTMLElement;
}>;
