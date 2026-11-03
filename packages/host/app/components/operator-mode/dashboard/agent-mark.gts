import type { TemplateOnlyComponent } from '@ember/component/template-only';

import BrandOpenai from '@cardstack/boxel-icons/brand-openai';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import assistantIcon from '../../ai-assistant/ai-assist-icon@2x.webp';

import ClaudeMark from './claude-mark';

import type { AgentKind } from './agent-kinds';

interface Signature {
  Element: HTMLSpanElement;
  Args: {
    kind: AgentKind;
    size?: 'small';
  };
}

// An agent's mark: Claude's and OpenAI's on a white tile, as the boxel.ai
// homepage shows them, and the assistant's own icon for Boxel AI Assistant.
// Decorative: the agent's name is always beside it.
const AgentMark: TemplateOnlyComponent<Signature> = <template>
  <span
    class={{cn 'agent-mark' is-small=(eq @size 'small')}}
    data-test-agent-mark={{@kind.id}}
    ...attributes
  >
    {{#if (eq @kind.id 'claude')}}
      <span class='agent-mark-tile'>
        <ClaudeMark
          class='agent-mark-icon'
          width='24'
          height='24'
          aria-hidden='true'
        />
      </span>
    {{else if (eq @kind.id 'codex')}}
      <span class='agent-mark-tile'>
        <BrandOpenai
          class='agent-mark-icon'
          width='24'
          height='24'
          aria-hidden='true'
        />
      </span>
    {{else}}
      <img
        class='agent-mark-image'
        src={{assistantIcon}}
        alt=''
        width='32'
        height='32'
      />
    {{/if}}
  </span>
  <style scoped>
    .agent-mark {
      --_agent-mark-size: 2rem;
      display: inline-flex;
      flex: none;
      width: var(--_agent-mark-size);
      height: var(--_agent-mark-size);
    }
    .agent-mark.is-small {
      --_agent-mark-size: 1.5rem;
    }
    .agent-mark-image {
      width: 100%;
      height: 100%;
    }
    .agent-mark-tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      border-radius: calc(var(--_agent-mark-size) * 7 / 32);
      background-color: var(--boxel-light);
      color: var(--boxel-dark);
    }
    .agent-mark-icon {
      width: 75%;
      height: 75%;
    }
  </style>
</template>;

export default AgentMark;
