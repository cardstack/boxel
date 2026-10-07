// Pretui — Toast: the transient notification card a Toaster stacks.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

export interface ToastSignature {
  Args: {
    title: string;
    message?: string;
    /** alias — Sonner / shadcn / Mantine all call the second line
     * `description`. Resolved in the template because this component is
     * template-only; the `{{else if}}` chain is the getter's equivalent. */
    description?: string;
  };
  Blocks: { icon: []; action: [] };
  Element: HTMLDivElement;
}

export const Toast: TemplateOnlyComponent<ToastSignature> = <template>
  <div class='pretui-toast' role='status' data-test-pretui-toast ...attributes>
    {{#if (has-block 'icon')}}{{yield to='icon'}}{{/if}}
    <div class='pretui-toast-body'>
      <div class='pretui-toast-title'>{{@title}}</div>
      {{#if @message}}<div class='pretui-toast-msg'>{{@message}}</div>
      {{else if @description}}<div
          class='pretui-toast-msg'
        >{{@description}}</div>{{/if}}
    </div>
    {{#if (has-block 'action')}}<div class='pretui-toast-action'>{{yield
          to='action'
        }}</div>{{/if}}
  </div>
  <style scoped>
    @layer PretComponent {
      .pretui-toast {
        --pretui-toast-max-w: 22.5rem;

        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        /* no stacking tier of its own: the toast is in flow, so whatever
           positions it (Toaster's fixed region, or the host's) owns its
           z-index; one here would paint an in-flow toast over sticky chrome */
        background-color: var(--popover);
        color: var(--popover-foreground);
        border-radius: var(--boxel-border-radius);
        box-shadow:
          0 0 0 1px var(--border),
          var(--shadow-md);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        width: max-content;
        max-width: var(--pretui-toast-max-w);
      }
      .pretui-toast-body {
        display: grid;
        gap: var(--boxel-sp-6xs);
        min-width: 0;
      }
      .pretui-toast-title {
        font-weight: 600;
      }
      .pretui-toast-msg {
        color: var(--muted-foreground);
        font-size: var(--boxel-caption-font-size);
      }
      .pretui-toast-action {
        margin-inline-start: var(--boxel-sp-xs);
        flex: none;
      }
    }
  </style>
</template>;
