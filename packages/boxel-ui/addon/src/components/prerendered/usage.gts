import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import Prerendered from './index.gts';

export default class PrerenderedUsage extends Component {
  css = '.red { color: red; }';
  html = '<h1 class="red">This is static prerendered HTML</h1>';

  <template>
    <FreestyleUsage
      @name='Prerendered Component'
      @description='Component that renders static HTML and CSS. Used for rendering pre-rendered content.'
    >
      <:example>
        <Prerendered @css={{this.css}} @html={{this.html}} />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='html'
          @description='Prerendered html'
          @value={{this.html}}
          @readOnly={{true}}
        />
        <Args.String
          @name='css'
          @description='CSS'
          @value={{this.css}}
          @readOnly={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
