interface Signature {
  Args: {
    html?: string;
    css?: string;
  };
  Blocks: {
    default: [];
  };
}

import type { TemplateOnlyComponent } from '@ember/component/template-only';

const Prerendered: TemplateOnlyComponent<Signature> = <template>
  <style unscoped>
    {{@css}}
  </style>

  {{{@html}}}

  {{yield}}
</template>;

export default Prerendered;
