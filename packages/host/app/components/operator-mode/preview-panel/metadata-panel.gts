import { service } from '@ember/service';
import Component from '@glimmer/component';

import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { sanitizeHtmlSafe } from '@cardstack/boxel-ui/helpers';

import type StoreService from '@cardstack/host/services/store';

import type { BaseDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';

interface Signature {
  Args: {
    card: BaseDef;
  };
}

// content-tag misparses angle brackets inside regex literals in .gts files,
// so we use RegExp constructor instead.
const AMP_RE = new RegExp('&', 'g');
const LT_RE = new RegExp('<', 'g');
const GT_RE = new RegExp('>', 'g');
const QUOT_RE = new RegExp('"', 'g');
const APOS_RE = new RegExp("'", 'g');

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(AMP_RE, '&amp;')
    .replace(LT_RE, '&lt;')
    .replace(GT_RE, '&gt;')
    .replace(QUOT_RE, '&quot;')
    .replace(APOS_RE, '&#039;');
}

// content-tag misparses HTML tag literals in .gts files,
// so we build span wrappers dynamically.
function spanWrap(cls: string, content: string): string {
  return `<${'span'} class="${cls}">${content}</${'span'}>`;
}

const KEY_RE = /(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)\s*:/g;
const STRING_RE = new RegExp(
  '(&quot;)((?:[^&]|&(?!quot;))*)(&quot;)(?!\\s*(?:<\\/span>)?\\s*:)',
  'g',
);
const NUMBER_RE = /\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;
const BOOL_RE = /\b(true|false)\b/g;
const NULL_RE = /\bnull\b/g;

function highlightJson(json: string): string {
  let escaped = escapeHtml(json);

  // Use a placeholder strategy to prevent number/boolean/null regexes from
  // matching inside already-highlighted key and string spans.
  // We replace keys and strings with unique placeholders first, apply
  // number/boolean/null highlighting on the remaining text, then restore.
  let placeholders: string[] = [];

  // Use a runtime-constructed sentinel to avoid control characters in regex
  // literals (no-control-regex) and content-tag parse issues with regex literals.
  let PH = String.fromCharCode(0xe000);
  escaped = escaped.replace(KEY_RE, (_m, q1, inner, q2) => {
    let html = `${spanWrap('json-key', `${q1}${inner}${q2}`)}:`;
    let idx = placeholders.length;
    placeholders.push(html);
    return `${PH}PH${idx}${PH}`;
  });
  escaped = escaped.replace(STRING_RE, (_m, q1, inner, q2) => {
    let html = spanWrap('json-string', `${q1}${inner}${q2}`);
    let idx = placeholders.length;
    placeholders.push(html);
    return `${PH}PH${idx}${PH}`;
  });

  // Now number/boolean/null regexes only see text outside of key/string spans.
  escaped = escaped.replace(NUMBER_RE, (_m, num) =>
    spanWrap('json-number', num),
  );
  escaped = escaped.replace(BOOL_RE, (_m, bool) =>
    spanWrap('json-boolean', bool),
  );
  escaped = escaped.replace(NULL_RE, () => spanWrap('json-null', 'null'));

  // Restore placeholders with the actual highlighted HTML.
  // content-tag misparses regex literals in .gts files; use RegExp constructor.
  let PLACEHOLDER_RE = new RegExp(`${PH}PH(\\d+)${PH}`, 'g');
  escaped = escaped.replace(PLACEHOLDER_RE, (_m, idx) => placeholders[idx]);

  return escaped;
}

export default class MetadataPanel extends Component<Signature> {
  @service declare private store: StoreService;

  @use private documentResource = resource(() => {
    let state = new TrackedObject<{
      json: string | undefined;
      isLoading: boolean;
      error: string | undefined;
    }>({
      json: undefined,
      isLoading: false,
      error: undefined,
    });

    let fileDef = this.args.card as FileDef;
    if (!fileDef?.id) {
      state.error = 'No file URL available';
      return state;
    }

    state.isLoading = true;
    (async () => {
      try {
        let doc = await this.store.serializeFileDefAsDocument(fileDef);
        state.json = JSON.stringify(doc, null, 2);
      } catch (e: any) {
        state.error = e?.message ?? 'Failed to serialize file metadata';
      } finally {
        state.isLoading = false;
      }
    })();
    return state;
  });

  private get highlightedJson() {
    let json = this.documentResource?.json;
    if (!json) {
      return '';
    }
    return highlightJson(json);
  }

  private get isLoading() {
    return this.documentResource?.isLoading ?? false;
  }

  private get error() {
    return this.documentResource?.error;
  }

  private get hasContent() {
    return Boolean(this.documentResource?.json);
  }

  <template>
    <article class='metadata-panel' data-test-metadata-panel>
      {{#if this.isLoading}}
        <div class='metadata-panel__loading'>Loading metadata...</div>
      {{else if this.error}}
        <div class='metadata-panel__error'>{{this.error}}</div>
      {{else if this.hasContent}}
        <pre
          class='metadata-panel__content'
          data-test-metadata-content
        >{{sanitizeHtmlSafe this.highlightedJson}}</pre>
      {{/if}}
    </article>
    <style scoped>
      .metadata-panel {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .metadata-panel__loading,
      .metadata-panel__error {
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
        text-align: center;
        padding: var(--boxel-sp-lg);
      }

      .metadata-panel__error {
        color: var(--boxel-error-100);
      }

      .metadata-panel__content {
        font-family: var(--boxel-monospace-font-family, monospace);
        white-space: pre-wrap;
        word-wrap: break-word;
        margin: 0;
        font-size: var(--boxel-font-sm);
        line-height: 1.5;
        background-color: var(--boxel-dark);
        color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        padding: var(--boxel-sp-lg);
      }

      .metadata-panel__content :deep(.json-key) {
        color: #9cdcfe;
      }

      .metadata-panel__content :deep(.json-string) {
        color: #ce9178;
      }

      .metadata-panel__content :deep(.json-number) {
        color: #b5cea8;
      }

      .metadata-panel__content :deep(.json-boolean) {
        color: #569cd6;
      }

      .metadata-panel__content :deep(.json-null) {
        color: #569cd6;
      }
    </style>
  </template>
}
