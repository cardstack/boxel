import { eq } from '@cardstack/boxel-ui/helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { TestRunnerModel } from '../routes/test-runner';

const TestRunner = <template>
  {{! Hidden prerender handshake node — read by Puppeteer }}
  <div
    data-prerender
    data-prerender-id='test-runner'
    data-prerender-nonce={{@model.nonce}}
    data-prerender-status={{@model.prerenderStatus}}
  >
    {{#if @model.errorMessage}}
      <pre data-prerender-error>{{@model.errorMessage}}</pre>
    {{else if @model.resultsString}}
      <pre data-test-results hidden>{{@model.resultsString}}</pre>
    {{/if}}
  </div>

  <div class='test-runner-sidebar'>
    {{#if @model.errorMessage}}
      <p class='error-message'>Error: {{@model.errorMessage}}</p>
    {{else if @model.results}}
      <p class='summary {{if (eq @model.results.status "pass") "pass" "fail"}}'>
        {{@model.results.passed}}/{{@model.results.total}}
        passed
        <span class='duration'>({{@model.results.duration}}ms)</span>
      </p>
      <ul class='test-list'>
        {{#each @model.results.tests as |t|}}
          <li class='test-item {{t.status}}'>
            <span class='icon'>{{if (eq t.status 'pass') '✓' '✗'}}</span>
            <span class='name'>{{t.name}}</span>
            {{#if t.error}}
              <pre class='error'>{{t.error.message}}</pre>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    {{else}}
      <p class='running'>Running…</p>
    {{/if}}
  </div>

  {{! #ember-testing is appended to <body> by the route's beforeModel so that
      Glimmer never clears its children during template reconciliation.
      The CSS below positions it to fill the right panel. }}

  <style>
    :root, body { margin: 0; height: 100%; }

    .test-runner-sidebar {
      padding: 1rem;
      background: #fafafa;
      font-family: monospace;
      font-size: 13px;
      height: 100%;
      box-sizing: border-box;
    }

    .summary { font-weight: bold; margin: 0 0 0.75rem; }
    .summary.pass { color: #2e7d32; }
    .summary.fail { color: #c62828; }
    .duration { font-weight: normal; color: #666; }
    .running { color: #666; }
    .error-message { color: #c62828; }

    .test-list {
      list-style: none; margin: 0; padding: 0;
      display: flex; flex-direction: column; gap: 2px;
    }

    .test-item {
      display: grid;
      grid-template-columns: 1.25rem 1fr;
      gap: 0 0.25rem;
      padding: 0.3rem 0.4rem;
      border-radius: 3px;
      border-left: 3px solid transparent;
    }

    .test-item.pass { border-left-color: #2e7d32; background: #f1f8f1; }
    .test-item.fail { border-left-color: #c62828; background: #fdf1f1; }
    .icon { font-weight: bold; }
    .test-item.pass .icon { color: #2e7d32; }
    .test-item.fail .icon { color: #c62828; }
    .name { overflow-wrap: anywhere; }

    .error {
      grid-column: 1 / -1;
      margin: 0.25rem 0 0; padding: 0.25rem;
      background: #fff0f0; color: #c62828;
      white-space: pre-wrap; overflow-wrap: anywhere;
      font-size: 11px; border-radius: 2px;
    }
  </style>
</template> satisfies TemplateOnlyComponent<{ model: TestRunnerModel }>;

export default RouteTemplate(TestRunner);
