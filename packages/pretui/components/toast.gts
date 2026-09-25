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
    {{#if (has-block 'action')}}<div class='pretui-toast-action'>{{yield to='action'}}</div>{{/if}}
  </div>
  <style scoped>
    .pretui-toast {
      display: flex;
      align-items: center;
      gap: 9px;
      /* kit stacking scale (pretui-css.gts): a toast reports something that
         just happened and must stay readable over whatever is open, so it is
         the one tier deliberately above `dialog`. `relative` is what makes
         the z-index apply — the toast is otherwise in flow and its consumer
         owns where it sits. */
      position: relative;
      z-index: var(--pretui-z-toast, 100);
      background: var(--popover);
      border-radius: 10px;
      box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 2px 10px rgb(0 0 0 / 0.08));
      padding: 7px 10px;
      font-size: var(--text-ui-md, 12.5px);
      width: max-content;
      max-width: 360px;
    }
    .pretui-toast-body {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .pretui-toast-title {
      font-weight: 600;
    }
    .pretui-toast-msg {
      color: var(--muted-foreground);
      font-size: var(--text-ui-sm, 11.5px);
    }
    .pretui-toast-action {
      margin-left: 8px;
      flex: none;
    }
  </style>
</template>;
