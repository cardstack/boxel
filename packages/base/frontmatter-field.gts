import type { Diagnostics, ToolContext } from '@cardstack/runtime-common';

import {
  Component,
  FieldDef,
  field,
  contains,
  type BaseDefComponent,
} from './card-api';
import { JsonField } from './json-field';

// Extraction-time inputs handed to `fromFrontmatter` by
// `MarkdownDef.extractAttributes`.
export interface FromFrontmatterContext {
  // The markdown file's URL; relative references in the frontmatter (e.g. a
  // skill tool's codeRef module) resolve against it.
  fileURL: string;
  // Owner-carrying context for constructing tool classes during index-time
  // schema generation. Only the indexing path provides one; its presence is
  // what enables the (module-loading, hence costly) schema work, so
  // interactive extract paths never pay for it.
  toolContext?: ToolContext;
}

// What `fromFrontmatter` hands back to `MarkdownDef.extractAttributes`.
export interface FromFrontmatterResult {
  // The frontmatter field's serialized attributes — the value that lands in
  // the search doc and, absent `fileMetaAttributes`, in the file-meta
  // resource too.
  attributes: Record<string, unknown>;
  // Index-only enrichment of `attributes` (e.g. a skill's generated tool
  // definitions) destined for the file-meta resource. Kept separate because
  // multi-KB generated content must never land in `search_doc`.
  fileMetaAttributes?: Record<string, unknown>;
  // Diagnostics findings this frontmatter contributes to the indexed row,
  // merged onto the row's `diagnostics` by the file indexer and surfaced via
  // `/_indexing-errors`. The extract still succeeds — findings never fail the
  // row. Which keys a subclass populates is its own knowledge (the base
  // contract is just "a bag of Diagnostics").
  diagnostics?: Partial<Diagnostics>;
}

// The parsed YAML frontmatter of a markdown file, captured as JSON. The base
// type holds the entire frontmatter in `rawContent`; when the frontmatter
// declares a recognized `boxel.kind` (e.g. `skill`), the concrete instance is a
// subclass (e.g. `SkillFrontmatterField`) selected by the kind registry, which
// adds typed fields on top of the raw copy.
export class FrontmatterField extends FieldDef {
  static displayName = 'Frontmatter';

  // The entire frontmatter (all top-level keys), as JSON — a lossless raw copy.
  // Not indexed for search; searchable bits are projected into typed fields
  // (e.g. `MarkdownDef.kind`, `SkillFrontmatterField.name`).
  @field rawContent = contains(JsonField);

  // Map a file's parsed frontmatter into this field's serialized attributes.
  // The base keeps the whole frontmatter as the raw copy; subclasses add their
  // own typed fields and any index-time enrichment of them. A subclass is the
  // only thing that knows its own frontmatter schema.
  static async fromFrontmatter(
    frontmatter: Record<string, unknown>,
    _context?: FromFrontmatterContext,
  ): Promise<FromFrontmatterResult> {
    return { attributes: { rawContent: frontmatter } };
  }

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get kind() {
      let raw = this.args.model?.rawContent as
        | { boxel?: { kind?: string } }
        | undefined;
      return raw?.boxel?.kind ?? '';
    }
    <template>{{this.kind}}</template>
  };
}
