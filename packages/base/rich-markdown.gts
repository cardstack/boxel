import {
  extractCardReferenceUrls,
  fieldSerializer,
  relativeTo,
  VirtualNetwork,
} from '@cardstack/runtime-common';
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
import MarkdownEditorModeSelect, {
  type MarkdownEditorMode,
} from './components/markdown-editor-mode-select';
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
          ? (virtualNetworkFor(this)?.toURL(rel).href ?? rel)
          : rel.href
        : '';
      return extractCardReferenceUrls(
        this.content,
        baseUrl,
        virtualNetworkFor(this) ?? new VirtualNetwork(),
      );
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
    get virtualNetwork() {
      return this.args.model ? virtualNetworkFor(this.args.model) : undefined;
    }
    get baseUrl(): string | null {
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? rel)
        : rel.href;
    }
    <template>
      <MarkdownTemplate
        @content={{this.content}}
        @linkedCards={{@model.linkedCards}}
        @cardReferenceBaseUrl={{this.baseUrl}}
        @cardReferenceVirtualNetwork={{this.virtualNetwork}}
      />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get content() {
      return this.args.model?.content ?? null;
    }
    get virtualNetwork() {
      return this.args.model ? virtualNetworkFor(this.args.model) : undefined;
    }
    get baseUrl(): string | null {
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? rel)
        : rel.href;
    }
    <template>
      <MarkdownTemplate
        @content={{this.content}}
        @linkedCards={{@model.linkedCards}}
        @cardReferenceBaseUrl={{this.baseUrl}}
        @cardReferenceVirtualNetwork={{this.virtualNetwork}}
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
      value: 'compose' as MarkdownEditorMode,
    });

    get _mode(): MarkdownEditorMode {
      return this._modeState.value;
    }

    updateContent = (markdown: string) => {
      this.args.model.content = markdown;
    };
    get virtualNetwork() {
      return this.args.model ? virtualNetworkFor(this.args.model) : undefined;
    }
    get baseUrl(): string | null {
      let model = this.args.model;
      let rel = model?.[relativeTo];
      if (!model || !rel) {
        return null;
      }
      return typeof rel === 'string'
        ? (virtualNetworkFor(model)?.toURL(rel).href ?? rel)
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
    setMode = (mode: MarkdownEditorMode) => {
      this._modeState.value = mode;
    };
    <template>
      <div class='rich-markdown-editor'>
        {{#if (eq this._mode 'preview')}}
          {{! Preview has no CodeMirrorEditor, so the sticky mode selector
              lives in its own docked bar above the rendered markdown. }}
          <div class='rich-markdown-toolbar' data-test-markdown-toolbar>
            <MarkdownEditorModeSelect @mode={{this._mode}} @onChange={{this.setMode}} />
          </div>
          <div class='rich-markdown-preview' data-test-markdown-preview>
            <MarkdownTemplate
              @content={{@model.content}}
              @linkedCards={{@model.linkedCards}}
              @cardReferenceBaseUrl={{this.baseUrl}}
              @cardReferenceVirtualNetwork={{this.virtualNetwork}}
            />
          </div>
        {{else}}
          <CardContextConsumer as |context|>
            <CodeMirrorEditor
              @content={{@model.content}}
              @onUpdate={{this.updateContent}}
              @linkedCards={{this.linkedCards}}
              @cardReferenceBaseUrl={{this.baseUrl}}
              @cardReferenceVirtualNetwork={{this.virtualNetwork}}
              @livePreview={{eq this._mode 'compose'}}
              @getCards={{context.getCards}}
            >
              <:leadingControls>
                <MarkdownEditorModeSelect @mode={{this._mode}} @onChange={{this.setMode}} />
              </:leadingControls>
            </CodeMirrorEditor>
          </CardContextConsumer>
        {{/if}}
      </div>

      <style scoped>
        .rich-markdown-editor {
          display: flex;
          flex-direction: column;
        }

        /* Single source of truth for the docked sticky bar, shared by the
           compose/source toolbar (rendered inside CodeMirrorEditor) and the
           preview-only bar below — keeps the two from drifting. CodeMirrorEditor
           is used solely by this field, so owning its bar appearance here is
           safe. */
        .rich-markdown-toolbar,
        .rich-markdown-editor :deep(.codemirror-toolbar) {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
          background: var(--boxel-100);
          border-bottom: 1px solid var(--boxel-200);
          border-top-left-radius: var(--boxel-border-radius);
          border-top-right-radius: var(--boxel-border-radius);
        }

        .rich-markdown-toolbar {
          border: 1px solid var(--boxel-border-color);
          border-bottom: 1px solid var(--boxel-200);
        }

        .rich-markdown-preview {
          min-height: 120px;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--boxel-border-color);
          border-top: none;
          border-bottom-left-radius: var(--boxel-border-radius);
          border-bottom-right-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
}

export default RichMarkdownField;
