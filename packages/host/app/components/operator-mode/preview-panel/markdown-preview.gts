import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';

import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import { Button } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import CardRenderer from '@cardstack/host/components/card-renderer';

import RenderedMarkdown from './rendered-markdown';

import type { BaseDef } from '@cardstack/base/card-api';

type ViewMode = 'source' | 'rendered';

interface Signature {
  Args: {
    card: BaseDef;
  };
}

export default class MarkdownPreview extends Component<Signature> {
  @tracked viewMode: ViewMode = 'source';
  @tracked capturedMarkdown = '';

  private captureMarkdownText = modifier((element: HTMLElement) => {
    let capture = () => {
      if (!element.isConnected) {
        return;
      }
      let output = element.querySelector('[data-markdown-output]');
      let text = (output ?? element).textContent?.trim() ?? '';
      if (text !== this.capturedMarkdown) {
        this.capturedMarkdown = text;
      }
    };

    scheduleOnce('afterRender', null, capture);

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    let observer = new MutationObserver(() =>
      scheduleOnce('afterRender', null, capture),
    );
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  });

  private get cardReferenceBaseUrl(): string | undefined {
    return 'id' in this.args.card
      ? ((this.args.card?.id as string | undefined) ?? undefined)
      : undefined;
  }

  private setViewMode = (mode: ViewMode) => {
    this.viewMode = mode;
  };

  <template>
    <div class='markdown-preview' data-test-markdown-preview>
      <div class='view-toggle' data-test-markdown-view-toggle>
        <Button
          class={{cn 'toggle-btn' active=(eq this.viewMode 'source')}}
          {{on 'click' (fn this.setViewMode 'source')}}
          aria-pressed={{if (eq this.viewMode 'source') 'true' 'false'}}
          data-test-markdown-view='source'
        >
          Source
        </Button>
        <Button
          class={{cn 'toggle-btn' active=(eq this.viewMode 'rendered')}}
          {{on 'click' (fn this.setViewMode 'rendered')}}
          aria-pressed={{if (eq this.viewMode 'rendered') 'true' 'false'}}
          data-test-markdown-view='rendered'
        >
          Rendered
        </Button>
      </div>

      {{! Hidden CardRenderer captures the raw markdown text via modifier }}
      <div
        class='capture-container'
        {{this.captureMarkdownText}}
        aria-hidden='true'
      >
        <CardRenderer @card={{@card}} @format='markdown' />
      </div>

      {{#if (eq this.viewMode 'source')}}
        <pre
          class='markdown-source'
          data-test-markdown-source
        >{{this.capturedMarkdown}}</pre>
      {{else}}
        <div class='markdown-rendered' data-test-markdown-rendered>
          <RenderedMarkdown
            @content={{this.capturedMarkdown}}
            @cardReferenceBaseUrl={{this.cardReferenceBaseUrl}}
          />
        </div>
      {{/if}}
    </div>

    <style scoped>
      .markdown-preview {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .view-toggle {
        display: flex;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-100);
        border-bottom: 1px solid var(--boxel-200);
      }

      .toggle-btn {
        --boxel-button-color: transparent;
        --boxel-button-text-color: var(--boxel-dark);
        --boxel-button-font: 600 var(--boxel-font-xs);
        min-height: unset;
        min-width: unset;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        border-color: var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }

      .toggle-btn.active {
        --boxel-button-color: var(--boxel-dark);
        --boxel-button-text-color: var(--boxel-light);
      }

      .capture-container {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
      }

      .markdown-source {
        flex: 1;
        overflow-y: auto;
        margin: 0;
        padding: var(--boxel-sp);
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-sm);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
        background: transparent;
      }

      .markdown-rendered {
        flex: 1;
        overflow-y: auto;
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}
