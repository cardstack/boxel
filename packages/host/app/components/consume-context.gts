import type { TemplateOnlyComponent } from '@ember/component/template-only';

import consumeContext from '@cardstack/host/modifiers/consume-context';

interface Signature {
  Args: {
    Named: {
      consume: () => void;
    };
  };
}

const ConsumeContextComponent: TemplateOnlyComponent<Signature> = <template>
  <div class='hide' {{consumeContext consume=@consume}} />
  <style scoped>
    .hide {
      display: none;
    }
  </style>
</template>;

export default ConsumeContextComponent;
