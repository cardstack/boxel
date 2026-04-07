import {
  extractCardReferenceUrls,
  relativeTo,
} from '@cardstack/runtime-common';

import {
  CardDef,
  Component,
  FieldDef,
  MarkdownField,
  StringField,
  contains,
  containsMany,
  field,
  linksToMany,
} from './card-api';
import MarkdownTemplate from './default-templates/markdown';
import ProseMirrorEditor from './prosemirror-editor';

/**
 * A composite FieldDef that stores markdown content and exposes structured
 * `linkedCards` relationships for embedded card references.
 *
 * Unlike `MarkdownField` (which extends StringField), this field is a
 * composite FieldDef with sub-fields for content, computed reference URLs,
 * and query-based linked cards.
 *
 * Usage:
 * ```
 * import RichMarkdownField from 'https://cardstack.com/base/rich-markdown';
 *
 * class MyCard extends CardDef {
 *   @field body = contains(RichMarkdownField);
 * }
 * ```
 */
export class RichMarkdownField extends FieldDef {
  static displayName = 'Rich Markdown';

  /** The raw markdown text. Uses MarkdownField for textarea edit UI. */
  @field content = contains(MarkdownField);

  /** Resolved absolute URLs of `:card[URL]` and `::card[URL]` references. */
  @field cardReferenceUrls = containsMany(StringField, {
    computeVia: function (this: RichMarkdownField) {
      if (!this.content) {
        return [];
      }
      let baseUrl = this[relativeTo]?.href ?? '';
      return extractCardReferenceUrls(this.content, baseUrl);
    },
  });

  /** Cards referenced in the markdown, loaded via query. */
  @field linkedCards = linksToMany(CardDef, {
    query: {
      filter: {
        in: { id: '$this.cardReferenceUrls' },
      },
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get content() {
      return this.args.model?.content ?? null;
    }
    get baseUrl(): string | null {
      return this.args.model?.[relativeTo]?.href ?? null;
    }
    <template>
      <MarkdownTemplate
        @content={{this.content}}
        @linkedCards={{@model.linkedCards}}
        @cardReferenceBaseUrl={{this.baseUrl}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get content() {
      return this.args.model?.content ?? null;
    }
    <template>
      <MarkdownTemplate @content={{this.content}} />
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    updateContent = (markdown: string) => {
      this.args.model.content = markdown;
    };
    <template>
      <ProseMirrorEditor
        @content={{@model.content}}
        @onUpdate={{this.updateContent}}
      />
    </template>
  };
}

export default RichMarkdownField;
