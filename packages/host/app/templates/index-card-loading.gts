import type { TemplateOnlyComponent } from '@ember/component/template-only';
import RouteTemplate from 'ember-route-template';
import CardController from '@cardstack/host/controllers/card';

interface Signature {
  Args: {
    controller: CardController;
    model: null;
  };
}

const IndexCardLoading: TemplateOnlyComponent<Signature> = <template>
  <div class='loading'>
    Loading…
  </div>
  <style>
    .loading {
      display: grid;
      justify-items: center;
      padding: var(--boxel-sp-xl);
    }
  </style>
</template>;

export default RouteTemplate(IndexCardLoading);
