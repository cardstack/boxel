import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { SafeString } from '@ember/template';
import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Args: {
    style: SafeString;
    isSettling: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

const KanbanGhost: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'ghost' settling=@isSettling}} style={{@style}} ...attributes>
    {{yield}}
  </div>

  <style scoped>
    .ghost {
      position: fixed;
      z-index: 9;
      pointer-events: none;
      border-radius: var(--_kanban-radius, 0.5rem);
      overflow: hidden;
      color: var(--_kanban-card-fg);
      background: var(--_kanban-card-bg);
      box-shadow:
        0 24px 60px rgba(0, 0, 0, 0.28),
        0 8px 20px rgba(0, 0, 0, 0.12),
        0 2px 6px rgba(0, 0, 0, 0.06);
      opacity: 0.97;
      transform: rotate(-2.5deg) scale(1.03);
    }
    .ghost.settling {
      transition:
        left 180ms cubic-bezier(0.4, 0, 0.2, 1),
        top 180ms cubic-bezier(0.4, 0, 0.2, 1),
        width 180ms cubic-bezier(0.4, 0, 0.2, 1),
        height 180ms cubic-bezier(0.4, 0, 0.2, 1),
        transform 180ms ease-out,
        box-shadow 180ms ease-out;
      transform: rotate(0deg) scale(1);
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.06),
        0 0 0 1px rgba(0, 0, 0, 0.04);
    }
  </style>
</template>;

export { KanbanGhost };
