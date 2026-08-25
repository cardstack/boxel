/**
 * The child-format cascade, in one place.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type { Format } from '../formats.ts';

/**
 * The child-format cascade: the formats `<@fields.x />` resolves to inside a
 * template rendering as `containingFormat`, when the author names none
 * (RP-2.6).
 *
 * This is the one definition of *this* cascade for every consumer outside
 * Base's own field components, and it mirrors `defaultFieldFormats` in
 * `@cardstack/base/field-component.gts`. A second copy renders nested cards
 * in the wrong format on whichever tier holds it — a divergence invisible in
 * that tier's own tests, since they would agree with its copy.
 *
 * It is the default cascade and nothing more. Three sibling rules narrow the
 * answer afterwards and are not expressible through this signature, which
 * sees neither the field's kind nor the target's definition kind:
 *
 * - RP-2.7: in `edit`, a linked CardDef or FileDef target renders `fitted` —
 *   a linked card is never edited inline — while a singular linked FieldDef
 *   keeps `edit` (`getChildFormat`, `@cardstack/base/card-api.gts`). A
 *   `linksToMany` editor is different again: it renders FieldDef elements as
 *   `atom` pills and card elements as a `fitted` sortable list
 *   (`getEditorChildFormat`, `@cardstack/base/links-to-many-component.gts`),
 *   so a tier applying only the singular rule renders a stack of full field
 *   editors where main shows pills.
 * - RP-2.5: a computed field is rewritten from `edit` to `embedded` at format
 *   resolution — on the `fieldDef` axis ONLY (`determineFormats`). `cardDef`
 *   stays `edit`, so a computed `linksTo` still takes the card branch with
 *   `cardDef: 'edit'` and seeds its children `edit`/`edit` from here. A tier
 *   that rewrites both axes diverges from main on exactly the case this
 *   function exists to keep aligned.
 * - RP-2.4: an explicit `@format` that is in the renderable inventory
 *   **replaces** this answer on both axes rather than narrowing it, and one
 *   outside the inventory is silently ignored rather than treated as an error
 *   (`determineFormats`). Note that an explicit format does not take this
 *   function out of the picture: Base feeds the *effective* format — explicit
 *   or defaulted — straight back through the cascade to seed the children's
 *   ambient defaults, so a tier that skips it under an explicit `@format`
 *   breaks every nested render beneath that node.
 *
 * A tier that applies only this function renders a linked card inline-
 * editable, which RP-2.7 says never happens.
 *
 * `containingFormat` is a plain string, not `Format`: an unknown format is
 * not an error here, it degrades to the display default exactly as it does in
 * Base.
 */
export function childFieldFormatsFor(containingFormat: string): {
  fieldDef: Format;
  cardDef: Format;
} {
  switch (containingFormat) {
    case 'edit':
      return { fieldDef: 'edit', cardDef: 'edit' };
    case 'atom':
    case 'head':
    case 'markdown':
      // Each of these recurses in itself, which is what makes it a fixed
      // point: a field inside a markdown template delegates to the child's
      // markdown template rather than to embedded/fitted HTML, so the
      // composed output is uniformly markdown text.
      //
      // `head` carries a known gap forward (RP-2.9, carried per RP-17.3):
      // FieldDef declares no `head` slot, so a contained field inside a
      // `head` template resolves to nothing and fails the render. Reproducing
      // it is deliberate — main behaves this way — and a fallback would be a
      // versioned change, not a fix applied here.
      return { fieldDef: containingFormat, cardDef: containingFormat };
    default:
      // isolated, embedded, fitted — and every unrecognized format, which
      // Base degrades the same way.
      return { fieldDef: 'embedded', cardDef: 'fitted' };
  }
}
