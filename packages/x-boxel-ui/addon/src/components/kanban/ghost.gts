import { cn } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { SafeString } from '@ember/template';

interface Signature {
  Args: {
    isSettling: boolean;
    style: SafeString;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const KanbanGhost: TemplateOnlyComponent<Signature> = <template>
  {{! Visual drag preview only — original card remains in the AT }}
  <div
    class={{cn 'ghost' settling=@isSettling}}
    style={{@style}}
    aria-hidden='true'
    ...attributes
  >
    {{yield}}
  </div>

  <style scoped>
    .ghost {
      position: fixed;
      left: 0;
      top: 0;
      z-index: var(--boxel-kanban-ghost-z-index, 9);
      will-change: translate;
      pointer-events: none;
      border-radius: var(--_kanban-radius, 0.5rem);
      overflow: hidden;
      color: var(--_kanban-card-fg);
      background: var(--_kanban-card-bg);
      box-shadow:
        0 24px 60px color-mix(in oklch, black 28%, transparent),
        0 8px 20px color-mix(in oklch, black 12%, transparent),
        0 2px 6px color-mix(in oklch, black 6%, transparent);
      opacity: 0.97;
      rotate: -2.5deg;
      scale: 1.03;
    }
    .ghost.settling {
      transition:
        translate 180ms cubic-bezier(0.4, 0, 0.2, 1),
        width 180ms cubic-bezier(0.4, 0, 0.2, 1),
        height 180ms cubic-bezier(0.4, 0, 0.2, 1),
        rotate 180ms ease-out,
        scale 180ms ease-out,
        box-shadow 180ms ease-out;
      rotate: 0deg;
      scale: 1;
      box-shadow:
        0 1px 2px color-mix(in oklch, black 6%, transparent),
        0 0 0 1px color-mix(in oklch, black 4%, transparent);
    }
  </style>
</template>;

export { KanbanGhost };
