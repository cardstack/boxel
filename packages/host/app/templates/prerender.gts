import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import Preview from '../components/preview';

export default RouteTemplate<{ Args: { model: CardDef } }>(<template>
  <div id='prerender-output'>
    <ExperimentalPrerender @cardInstance={{@model}} />
  </div>
</template>);

class ExperimentalPrerender extends Component<{
  Args: { cardInstance: CardDef };
}> {
  get targetCard() {
    return 'http://localhost:4201/drafts/BlogPost/1';
  }
  <template>
    <Preview @card={{@cardInstance}} @format='isolated' />
  </template>
}
