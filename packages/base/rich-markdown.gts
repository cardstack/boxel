import {
  cardIdToURL,
  extractCardReferenceUrls,
  fieldSerializer,
  relativeTo,
} from '@cardstack/runtime-common';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { TrackedObject } from 'tracked-built-ins';
import { eq } from '@cardstack/boxel-ui/helpers';

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
  virtualNetworkFor,
} from './card-api';
import MarkdownTemplate from './default-templates/markdown';
import CodeMirrorEditor from './codemirror-editor';
import { CardContextConsumer } from './field-component';

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
  static [fieldSerializer] = 'string-to-content' as const;

  /** The raw markdown text. Uses MarkdownField for textarea edit UI. */
  @field content = contains(MarkdownField);

  /** Resolved absolute URLs of `:card[URL]` and `::card[URL]` references. */
  @field cardReferenceUrls = containsMany(StringField, {
    computeVia: function (this: RichMarkdownField) {
      if (!this.content) {
        return [];
      }
      let rel = this[relativeTo];
      let baseUrl = rel
        ? typeof rel === 'string'
          ? (virtualNetworkFor(this)?.toURL(rel).href ?? cardIdToURL(rel).href)
          : rel.href
        : '';
      return extractCardReferenceUrls(this.content, baseUrl);
    },
  });

  /** Cards referenced in the markdown, loaded via query. */
  @field linkedCards = linksToMany(CardDef, {
    isUsed: true,
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
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? cardIdToURL(rel).href)
        : rel.href;
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
    get baseUrl(): string | null {
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? cardIdToURL(rel).href)
        : rel.href;
    }
    <template>
      <MarkdownTemplate
        @content={{this.content}}
        @linkedCards={{@model.linkedCards}}
        @cardReferenceBaseUrl={{this.baseUrl}}
      />
    </template>
  };

  // CS-10786: author-authored markdown passes through verbatim — double-
  // escaping would corrupt the user's formatting. Mirrors MarkdownField's
  // approach.
  static markdown = class Markdown extends Component<typeof this> {
    get text() {
      return this.args.model?.content ?? '';
    }
    <template>{{this.text}}</template>
  };

  static edit = class Edit extends Component<typeof this> {
    _modeState = new TrackedObject({
      value: 'compose' as 'compose' | 'source' | 'preview',
    });

    get _mode(): 'compose' | 'source' | 'preview' {
      return this._modeState.value;
    }

    updateContent = (markdown: string) => {
      this.args.model.content = markdown;
    };
    get baseUrl(): string | null {
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? cardIdToURL(rel).href)
        : rel.href;
    }
    get linkedCards(): CardDef[] | null {
      try {
        return this.args.model?.linkedCards ?? null;
      } catch {
        // linksToMany query may fail in environments without a full card store
        return null;
      }
    }
    setMode = (mode: 'compose' | 'source' | 'preview') => {
      this._modeState.value = mode;
    };
    <template>
      <div class='rich-markdown-editor'>
        <div class='rich-markdown-mode-switcher' data-test-mode-switcher>
          <button
            class='mode-btn {{if (eq this._mode "compose") "mode-btn--active"}}'
            data-test-mode-compose
            type='button'
            {{on 'click' (fn this.setMode 'compose')}}
          >Compose</button>
          <button
            class='mode-btn {{if (eq this._mode "source") "mode-btn--active"}}'
            data-test-mode-source
            type='button'
            {{on 'click' (fn this.setMode 'source')}}
          >Source</button>
          <button
            class='mode-btn {{if (eq this._mode "preview") "mode-btn--active"}}'
            data-test-mode-preview
            type='button'
            {{on 'click' (fn this.setMode 'preview')}}
          >Preview</button>
        </div>

        {{#if (eq this._mode 'preview')}}
          <div class='rich-markdown-preview' data-test-markdown-preview>
            <MarkdownTemplate
              @content={{@model.content}}
              @linkedCards={{@model.linkedCards}}
              @cardReferenceBaseUrl={{this.baseUrl}}
            />
          </div>
        {{else}}
          <CardContextConsumer as |context|>
            <CodeMirrorEditor
              @content={{@model.content}}
              @onUpdate={{this.updateContent}}
              @linkedCards={{this.linkedCards}}
              @cardReferenceBaseUrl={{this.baseUrl}}
              @livePreview={{eq this._mode 'compose'}}
              @getCards={{context.getCards}}
            />
          </CardContextConsumer>
        {{/if}}
      </div>

      <style scoped>
        .rich-markdown-editor {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxxs);
        }

        .rich-markdown-mode-switcher {
          display: flex;
          width: fit-content;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          overflow: hidden;
        }

        .mode-btn {
          padding: 2px 12px;
          border: none;
          border-right: 1px solid var(--boxel-border-color, #c4c4c4);
          background: transparent;
          font: inherit;
          font-size: 0.8rem;
          cursor: pointer;
          color: var(--boxel-400, #666);
          transition:
            background-color 0.15s,
            color 0.15s;
        }

        .mode-btn:last-child {
          border-right: none;
        }

        .mode-btn:hover:not(.mode-btn--active) {
          background: var(--boxel-100, #f5f5f5);
        }

        .mode-btn--active {
          background: var(--boxel-highlight, #0078d4);
          color: white;
        }

        .rich-markdown-preview {
          min-height: 120px;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
        }
      </style>
    </template>
  };
}

export default RichMarkdownField;
