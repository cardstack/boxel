import { describe, it, expect } from 'vitest';

import { getIconStubModule } from '../../src/lib/test-engine.js';

// `boxel test` serves this stub for every
// `/@cardstack/boxel-icons/v1/icons/<name>.js` request so base modules
// load without the monorepo's boxel-icons dev server (CS-11376). If the
// stub stops compiling to a valid component module, every CardDef render
// breaks at module-load time, so guard the compiled shape here rather
// than only catching it in a full browser run.
describe('getIconStubModule', () => {
  it('compiles to a module with a default export', async () => {
    let mod = await getIconStubModule();
    expect(mod.length).toBeGreaterThan(0);
    expect(mod).toMatch(/default/);
  });

  it('compiles the glimmer template (not raw <template> source)', async () => {
    let mod = await getIconStubModule();
    // content-tag + the ember template plugin turn `<template>` into a
    // precompiled template; the raw tag must not survive into the output.
    expect(mod).not.toContain('<template>');
    expect(mod).toMatch(/setComponentTemplate|template-factory|precompile/);
  });

  it('caches: repeat calls return the same Promise (no recompile)', () => {
    // Compare Promise identity, not the resolved strings — two separate
    // compilations would produce equal strings and pass a value check,
    // so that wouldn't prove the result is cached.
    expect(getIconStubModule()).toBe(getIconStubModule());
  });
});
