import GlimmerComponent from '@glimmer/component';
import { eq } from '@cardstack/boxel-ui/helpers';
import type { SerializedError } from '@cardstack/runtime-common';

export type BrokenLinkState = 'error' | 'not-found';
export type BrokenLinkFormat = 'isolated' | 'fitted' | 'embedded' | 'atom';

export interface BrokenLinkTemplateArgs {
  brokenUrl: string;
  errorDoc: SerializedError;
  state: BrokenLinkState;
  format: BrokenLinkFormat;
}

interface NormalizedAdditionalError {
  message: string;
  status?: number;
  title?: string;
  stack?: string;
}

// Only http(s) URLs are safe to drop into an <a href> — `javascript:` and
// `data:` URLs in an anchor execute on click. The brokenUrl flows from
// trusted card-serialization data, but a corrupted realm could still ship
// a non-http reference; we fall back to plain text in that case.
function isSafeHttpUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  try {
    let parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default class BrokenLinkTemplate extends GlimmerComponent<{
  Args: BrokenLinkTemplateArgs;
}> {
  private get isNotFound() {
    return this.args.state === 'not-found';
  }

  private get headline() {
    return this.isNotFound
      ? 'Linked card not found'
      : 'Linked card failed to load';
  }

  private get statusLabel(): string {
    let { errorDoc } = this.args;
    if (!errorDoc) {
      return '';
    }
    let pieces: string[] = [];
    if (typeof errorDoc.status === 'number') {
      pieces.push(String(errorDoc.status));
    }
    if (errorDoc.title) {
      pieces.push(errorDoc.title);
    }
    return pieces.join(' · ');
  }

  private get errorMessage(): string {
    return this.args.errorDoc?.message ?? '';
  }

  private get errorStack(): string {
    return this.args.errorDoc?.stack ?? '';
  }

  private get isErrorState(): boolean {
    return this.args.state === 'error';
  }

  private get urlIsSafe(): boolean {
    return isSafeHttpUrl(this.args.brokenUrl);
  }

  private get additionalErrors(): NormalizedAdditionalError[] {
    let raw = this.args.errorDoc?.additionalErrors;
    if (!Array.isArray(raw)) {
      return [];
    }
    let normalized: NormalizedAdditionalError[] = [];
    for (let entry of raw) {
      if (entry == null || typeof entry !== 'object') {
        continue;
      }
      let message =
        typeof entry.message === 'string' && entry.message.length > 0
          ? entry.message
          : typeof entry.title === 'string' && entry.title.length > 0
            ? entry.title
            : '';
      if (!message) {
        continue;
      }
      normalized.push({
        message,
        status: typeof entry.status === 'number' ? entry.status : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        stack: typeof entry.stack === 'string' ? entry.stack : undefined,
      });
    }
    return normalized;
  }

  <template>
    <div
      class='broken-link-template {{@format}} {{@state}}'
      data-test-broken-link-template={{@format}}
      data-test-broken-link-state={{@state}}
    >
      {{#if (eq @format 'atom')}}
        <span class='atom-line'>
          <span class='atom-marker' aria-hidden='true'>!</span>
          <span class='atom-label'>
            {{if this.isNotFound 'Not found' 'Error'}}:
          </span>
          <span class='atom-url' data-test-broken-link-url>{{@brokenUrl}}</span>
        </span>
      {{else}}
        <div class='headline-row'>
          <span class='marker' aria-hidden='true'>!</span>
          <span class='headline' data-test-broken-link-headline>
            {{this.headline}}
          </span>
        </div>
        {{#if this.urlIsSafe}}
          <a
            class='url'
            href={{@brokenUrl}}
            target='_blank'
            rel='noopener noreferrer'
            data-test-broken-link-url
          >
            {{@brokenUrl}}
          </a>
        {{else}}
          {{! Unsafe protocol — render as text so a click cannot execute. }}
          <span class='url' data-test-broken-link-url>{{@brokenUrl}}</span>
        {{/if}}
        {{#if this.statusLabel}}
          <div class='status' data-test-broken-link-status>
            {{this.statusLabel}}
          </div>
        {{/if}}
        {{#unless (eq @format 'fitted')}}
          {{! For not-found, message is always "Could not find <url>" — the
              URL is already rendered prominently above, so suppress it.
              Show the message only when state == 'error', where it carries
              the actual error reason. }}
          {{#if this.isErrorState}}
            {{#if this.errorMessage}}
              <div class='message' data-test-broken-link-message>
                {{this.errorMessage}}
              </div>
            {{/if}}
          {{/if}}
        {{/unless}}
        {{#if (eq @format 'isolated')}}
          {{#if this.errorStack}}
            <pre
              class='stack'
              data-test-broken-link-stack
            >{{this.errorStack}}</pre>
          {{/if}}
          {{#let this.additionalErrors as |additionalErrors|}}
            {{#if additionalErrors.length}}
              <details class='additional-errors'>
                <summary data-test-broken-link-additional-errors-toggle>
                  {{additionalErrors.length}}
                  additional error{{if (eq additionalErrors.length 1) '' 's'}}
                </summary>
                <ul>
                  {{#each additionalErrors as |err i|}}
                    <li data-test-broken-link-additional-error={{i}}>
                      {{#if err.status}}
                        <span class='additional-status'>{{err.status}}</span>
                      {{/if}}
                      <span class='additional-message'>{{err.message}}</span>
                      {{#if err.stack}}
                        <pre class='additional-stack'>{{err.stack}}</pre>
                      {{/if}}
                    </li>
                  {{/each}}
                </ul>
              </details>
            {{/if}}
          {{/let}}
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .broken-link-template {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border: 1px dashed var(--boxel-300);
        border-radius: var(--boxel-form-control-border-radius);
        color: var(--boxel-dark);
        font: 500 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: hidden;
      }
      .broken-link-template.error {
        background-color: var(--boxel-error-100, #fdecec);
        border-color: var(--boxel-error-200, #f5c2c0);
      }

      /* Per-format sizing — mirrors field-component.gts:450-481 so the
         placeholder occupies the same footprint as the card it stands in for. */
      .broken-link-template.fitted {
        width: 100%;
        height: 100%;
        min-height: 40px;
        max-height: 600px;
        container-type: size;
        gap: 2px;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        font: 500 var(--boxel-font-xs);
      }
      .broken-link-template.embedded {
        container-type: inline-size;
        width: 100%;
        padding: var(--boxel-sp-xs);
        font: 500 var(--boxel-font-xs);
        gap: 2px;
      }
      .broken-link-template.embedded .message {
        /* Clamp long error messages so the placeholder fits even when the
           parent embedded slot is height-constrained (e.g. a 110px tall row
           inside a tight flex container). The full message remains in the
           DOM for screen readers / AI consumers. */
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-clamp: 2;
        overflow: hidden;
      }
      .broken-link-template.isolated {
        width: 100%;
        height: 100%;
        padding: var(--boxel-sp);
        font: 500 var(--boxel-font);
      }
      .broken-link-template.atom {
        display: inline-flex;
        align-items: center;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        font: 500 var(--boxel-font-xs);
        gap: 0;
      }

      .headline-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      .marker {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 1.1em;
        height: 1.1em;
        border-radius: 50%;
        background-color: var(--boxel-error-300, #d9534f);
        color: var(--boxel-light, #fff);
        font-size: 0.75em;
        font-weight: 700;
        line-height: 1;
      }
      .headline {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .url {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.85em;
        word-break: break-all;
        color: var(--boxel-dark);
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: var(--boxel-450, #6f6f6f);
      }
      .status {
        color: var(--boxel-450, #6f6f6f);
        font-size: 0.8em;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .message {
        font-weight: 400;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.9em;
      }
      .stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.75em;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-200);
        border-radius: var(--boxel-form-control-border-radius);
        max-height: 240px;
        overflow: auto;
      }
      .additional-errors {
        font-size: 0.85em;
      }
      .additional-errors summary {
        cursor: pointer;
        color: var(--boxel-450, #6f6f6f);
      }
      .additional-errors ul {
        list-style: none;
        padding: 0;
        margin: var(--boxel-sp-5xs) 0 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .additional-status {
        display: inline-block;
        padding: 0 var(--boxel-sp-5xs);
        margin-right: var(--boxel-sp-5xs);
        background-color: var(--boxel-200);
        border-radius: var(--boxel-form-control-border-radius);
        font-weight: 600;
      }
      .additional-stack {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.85em;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 2px 0 0;
      }

      .atom-line {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        min-width: 0;
      }
      .atom-marker {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 0.95em;
        height: 0.95em;
        border-radius: 50%;
        background-color: var(--boxel-error-300, #d9534f);
        color: var(--boxel-light, #fff);
        font-size: 0.7em;
        font-weight: 700;
        line-height: 1;
      }
      .atom-label {
        font-weight: 600;
      }
      .atom-url {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: 0.9em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      /* Container queries: when the host slot is small (e.g. a 65px
         linksToMany row, a small fitted badge) we squeeze the layout
         further so the URL stays the dominant signal. */
      @container (max-height: 65px) {
        .headline-row .headline {
          font-size: 0.85em;
        }
        .url {
          font-size: 0.8em;
        }
        .status {
          display: none;
        }
      }
      @container (max-width: 200px) {
        .headline {
          display: none;
        }
      }
    </style>
  </template>
}
