/**
 * Every shape that crosses a trust boundary between the Host and code the
 * Host does not trust (RP-14).
 *
 * Three properties make this module what it is, and each one is a constraint
 * on what may be added here:
 *
 * 1. **No Ember imports, and nothing that pulls the Host's module graph.**
 *    The protocol is evaluated inside a SES Compartment and inside an
 *    origin-isolated iframe child, neither of which has that graph. Every
 *    import across these files is either `import type`, erased entirely, or a
 *    pure shape predicate from `card-document-shape.ts` — a module that exists
 *    precisely so a caller can recognize a shape without pulling the heavy
 *    runtime chain rooted at `code-ref.ts`.
 *    `scripts/check-protocol-import-closure.mts` holds this to it.
 * 2. **Inert data only.** No live object crosses a boundary — no store,
 *    loader, service, class, component instance, callback, DOM node, or
 *    browser event. Every record type is declared through `Cloneable`, which
 *    proves at compile time that it is `structuredClone`-able JSON data.
 * 3. **Versioned.** Every record that crosses on its own carries the protocol
 *    version and the features it requires; a consumer checks both before it
 *    applies any part of a record, and fails closed to its last-known-good
 *    output otherwise (RP-14.3). Records that only ever travel inside another
 *    — `ResolvedField` in an operation's result, `ProjectedError` in a
 *    rejection — are versioned by the record or the response carrying them,
 *    and carry no envelope of their own.
 *
 * This module is deliberately absent from `index.ts`: reaching it through the
 * `@cardstack/runtime-common` barrel would drag the barrel's own graph in,
 * which defeats property 1 for the two consumers that need it most. Import it
 * by path — `@cardstack/runtime-common/boxel-execution-protocol`.
 */

export * from './boxel-execution-protocol/child-formats.ts';
export * from './boxel-execution-protocol/cloneable.ts';
export * from './boxel-execution-protocol/component-update.ts';
export * from './boxel-execution-protocol/instance-projection.ts';
export * from './boxel-execution-protocol/projected-error.ts';
export * from './boxel-execution-protocol/refusal.ts';
export * from './boxel-execution-protocol/runtime.ts';
export * from './boxel-execution-protocol/safe-event.ts';
export * from './boxel-execution-protocol/template-bundle.ts';
export * from './boxel-execution-protocol/type-description.ts';
export * from './boxel-execution-protocol/untrusted-input.ts';
export * from './boxel-execution-protocol/version.ts';
