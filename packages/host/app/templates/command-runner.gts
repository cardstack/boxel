import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import { CardContainer } from '@cardstack/boxel-ui/components';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type { CommandRunnerModel } from '../routes/command-runner';

const CommandRunner = <template>
  <div
    data-prerender
    data-prerender-id='command-runner'
    data-prerender-nonce={{@model.nonce}}
    data-prerender-status={{@model.prerenderStatus}}
  >
    {{#if @model.error}}
      <pre data-prerender-error>{{@model.error.message}}</pre>
    {{else}}
      {{#if @model.cardResult}}
        <CardContainer class='command-runner-result'>
          <CardRenderer @card={{@model.cardResult}} @format='isolated' />
        </CardContainer>
      {{/if}}
      {{#if @model.cardResultString}}
        <pre data-command-result hidden>{{@model.cardResultString}}</pre>
      {{/if}}
    {{/if}}
  </div>
</template> satisfies TemplateOnlyComponent<{ model: CommandRunnerModel }>;

export default RouteTemplate(CommandRunner);
