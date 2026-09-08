/**
 * The request-context builtins: `params`, `actor` and `instance`.
 *
 * These read no arguments beyond a key name — their whole answer comes from
 * the context the host scoped around the evaluation — so each case supplies
 * one through `context` and asserts what the program read out of it. They
 * resolve only in the mutation library set, so every case names it.
 *
 * The values here are deliberately unlike the document a program edits: a
 * case that read `.` instead of the context would produce the input rather
 * than these, and say so.
 */
import { deepStrictEqual } from 'node:assert';
import { inMutationLibraries, jqCases, type CoverageCase } from './case.ts';

const context = {
  params: { body: 'Looks good to me', mentions: ['user:grace'], count: 2 },
  actor: { id: 'user:ada', displayName: 'Ada' },
  instance: { id: 'https://example.test/Post/1', commentCount: 4 },
};

/** The document a program is editing, which none of these builtins read. */
const editedDocument = {
  body: 'the document, not the payload',
  id: 'the document id, not the context one',
};

const cases: CoverageCase[] = [
  {
    covers: 'params/1',
    source: 'params("body")',
    input: editedDocument,
    context,
    expected: 'Looks good to me',
  },
  {
    covers: 'params/1',
    // A key holding a non-scalar comes back whole rather than flattened into
    // the output stream, so a payload list can be appended as one item.
    source: 'params("mentions")',
    context,
    outputs: [['user:grace']],
  },
  {
    covers: 'params/1',
    source: 'params("nope")',
    context,
    // The operation layer checks declared keys before a program runs; this is
    // the backstop, and it names the keys that are there so a typo is
    // obvious from the message alone.
    throws: /asks for "nope".*"body", "count", "mentions"/,
  },
  {
    covers: 'params/1',
    source: 'params("body")',
    // No `context`: a program evaluated outside every scope gets an error
    // rather than `null`, which would append a missing comment body.
    throws: /needs a request context/,
  },
  {
    covers: 'params/1',
    source: 'params("body")',
    context: { actor: context.actor },
    throws: /needs the payload the caller sent/,
  },
  {
    covers: 'actor/0',
    source: 'actor()',
    input: editedDocument,
    context,
    check(outputs) {
      deepStrictEqual(outputs, [{ id: 'user:ada', displayName: 'Ada' }]);
    },
  },
  {
    covers: 'actor/0',
    source: 'actor()',
    context: { params: context.params },
    throws: /needs the caller identity/,
  },
  {
    covers: 'actor/1',
    source: 'actor("id")',
    input: editedDocument,
    context,
    expected: 'user:ada',
  },
  {
    covers: 'actor/1',
    source: 'actor("id")',
    // An actor the host supplied as something other than an object is a host
    // defect, and is reported as one instead of being indexed into.
    context: { actor: 'user:ada' },
    throws: /to be an object, but the host supplied string/,
  },
  {
    covers: 'instance/0',
    source: 'instance() | .commentCount',
    input: editedDocument,
    context,
    expected: 4,
  },
  {
    covers: 'instance/1',
    source: 'instance("id")',
    input: editedDocument,
    context,
    expected: 'https://example.test/Post/1',
  },
  {
    covers: 'instance/1',
    source: 'instance("id")',
    context: { params: context.params, actor: context.actor },
    throws: /needs the stored document being edited/,
  },
  {
    covers: 'instance/1',
    source: 'instance("nickname")',
    context,
    // An absent field on a stored document is ordinary, so the message names
    // the reading that tolerates it rather than only refusing.
    throws: /Use `instance\(\)` and index it if the key may be absent\./,
  },
];

export const requestContextCases: CoverageCase[] = jqCases(
  cases.map(inMutationLibraries),
);
