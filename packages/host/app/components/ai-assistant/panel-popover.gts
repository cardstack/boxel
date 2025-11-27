import type { TemplateOnlyComponent } from '@ember/component/template-only';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    header: [];
    body: [];
  };
  Args: { onClose: () => void };
}

const AiAssistantPanelPopover: TemplateOnlyComponent<Signature> = <template>
  <style scoped>
    .panel-popover {
      position: absolute;
      top: 1.5rem;
      right: 1.875rem;
      margin-top: var(--boxel-sp-sm);
      width: 320px;
      min-height: 12.5rem;
      max-height: 75vh;
      background: var(--ai-assistant-menu-background);
      border: 1px solid var(--past-sessions-divider-color);
      border-radius: var(--boxel-border-radius);
      color: var(--boxel-light);
      box-shadow: 0 5px 15px 0 rgba(0, 0, 0, 0.5);
      z-index: var(--host-ai-panel-popover-z-index);
      display: flex;
      flex-direction: column;
      timeline-scope: --past-sessions-scroll-timeline;
    }

    .header {
      --box-shadow-offset-x: 0;
      --box-shadow-offset-y: 7px;
      --box-shadow-blur-radius: 15px;
      --box-shadow-spread-radius: -7px;
      --box-shadow-color-start: rgba(0, 0, 0, 0);
      --box-shadow-color-end: rgba(0, 0, 0, 0.75);

      --box-shadow-start: var(--box-shadow-offset-x) var(--box-shadow-offset-y)
        var(--box-shadow-blur-radius) var(--box-shadow-spread-radius)
        var(--box-shadow-color-start);

      --box-shadow-end: var(--box-shadow-offset-x) var(--box-shadow-offset-y)
        var(--box-shadow-blur-radius) var(--box-shadow-spread-radius)
        var(--box-shadow-color-end);

      position: relative;
      padding: var(--boxel-sp-xs);
      color: var(--boxel-200);
      font-weight: 700;
      letter-spacing: var(--boxel-lsp-xs);
      line-height: 1.2;

      box-shadow: var(--box-shadow-start);

      animation: scroll-past-sessions linear forwards;
      animation-timeline: --past-sessions-scroll-timeline;
    }
    .header :deep(button) {
      transform: rotate(180deg);
      position: absolute;
      right: var(--boxel-sp-xs);
      top: var(--boxel-sp-xs);
    }

    .body {
      overflow-y: auto;
      flex-grow: 1;
    }

    @keyframes scroll-past-sessions {
      0% {
        box-shadow: var(--box-shadow-start);
      }
      1% {
        box-shadow: var(--box-shadow-end);
      }
      100% {
        box-shadow: var(--box-shadow-end);
      }
    }
  </style>

  <div
    {{onClickOutside @onClose exceptSelector='.past-session-menu,.delete'}}
    class='panel-popover'
    ...attributes
  >
    <header class='header'>
      {{yield to='header'}}
    </header>
    <div class='body' tabindex='0'>
      {{yield to='body'}}
    </div>
  </div>
</template>;

export default AiAssistantPanelPopover;
