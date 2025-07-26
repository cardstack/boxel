import RouteTemplate from 'ember-route-template';
import { Model } from '../routes/render';

export default RouteTemplate<{ model: Model }>(
  <template>
  <div data-prerender data-prerender-status={{if @model.ready "ready" "loading"}}>
    {{outlet}}
  </div>
</template>,
);
