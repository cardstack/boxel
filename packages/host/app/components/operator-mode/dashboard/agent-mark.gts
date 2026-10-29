import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, eq } from '@cardstack/boxel-ui/helpers';

import type { AgentKind } from './agent-kinds';

interface Signature {
  Element: HTMLSpanElement;
  Args: {
    kind: AgentKind;
    size?: 'small';
  };
}

// A neutral placeholder for an agent's mark. Decorative: the agent's name is
// always beside it.
const AgentMark: TemplateOnlyComponent<Signature> = <template>
  <span
    class={{cn 'agent-mark' is-small=(eq @size 'small')}}
    aria-hidden='true'
    ...attributes
  >
    {{@kind.monogram}}
  </span>
  <style scoped>
    .agent-mark {
      --_agent-mark-size: 2rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: var(--_agent-mark-size);
      height: var(--_agent-mark-size);
      border-radius: 22%;
      background-color: var(--muted);
      color: var(--muted-foreground);
      box-shadow: inset 0 0 0 1px var(--boxel-light-10);
      font-family: var(--boxel-monospace-font-family);
      font-size: calc(var(--_agent-mark-size) * 0.4);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .agent-mark.is-small {
      --_agent-mark-size: 1.5rem;
    }
  </style>
</template>;

export default AgentMark;
