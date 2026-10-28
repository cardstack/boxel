// A key page laid out as a card is in its edit format: a muted header band with
// the page's title and what it is for, then the page's fields on white, one
// labelled row each, and the page's buttons under them.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Args: { heading: string };
  Blocks: { intro: []; default: []; actions: [] };
  Element: HTMLElement;
}

const EditPage: TemplateOnlyComponent<Signature> = <template>
  <section class='edit-page' ...attributes>
    <header class='page-header'>
      <h1 class='heading' data-test-keys-heading>{{@heading}}</h1>
      {{#if (has-block 'intro')}}
        <div class='intro'>{{yield to='intro'}}</div>
      {{/if}}
    </header>
    {{#if (has-block)}}
      <div class='fields'>
        {{yield}}
      </div>
    {{/if}}
    {{#if (has-block 'actions')}}
      <footer class='actions'>{{yield to='actions'}}</footer>
    {{/if}}
  </section>

  <style scoped>
    .edit-page {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .page-header {
      padding: var(--boxel-sp-lg) var(--boxel-sp-xl);
      background-color: var(--muted);
      border-bottom: 1px solid var(--border);
    }
    .heading {
      margin: 0;
      font-size: var(--boxel-font-size-lg);
      line-height: var(--boxel-line-height-lg);
      font-weight: 600;
      color: var(--foreground);
    }
    .intro {
      margin-top: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
      overflow-wrap: anywhere;
    }
    .fields {
      display: grid;
      gap: var(--boxel-sp-lg);
      padding: var(--boxel-sp-xl);
      background-color: var(--background);
    }
    .page-header + .actions {
      padding-top: var(--boxel-sp-xl);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--boxel-sp-xs);
      padding: 0 var(--boxel-sp-xl) var(--boxel-sp-xl);
    }
  </style>
</template>;

export default EditPage;
