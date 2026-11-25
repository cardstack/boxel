import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { Alert } from '@cardstack/pretui/components/alert';

import type { DanglingRoutingRule } from '@cardstack/host/utils/dangling-routing-rules';

interface Signature {
  Args: { rules: DanglingRoutingRule[] };
}

// Warns that some of the realm's host routing rules point to a card that no
// longer exists. Shows nothing when there are none.
const DanglingRoutingWarning: TemplateOnlyComponent<Signature> = <template>
  {{#if @rules.length}}
    <div class='dangling-routing-warning'>
      <Alert
        @tone='warning'
        @title='Some host routing rules point to a card that no longer exists'
        data-test-dangling-routing-warning
      >
        Visitors to these paths get a “page not found” error at each host URL.
        <ul class='rules'>
          {{#each @rules as |rule|}}
            <li data-test-dangling-routing-rule={{rule.path}}>
              <code>{{rule.path}}</code>
              <span aria-hidden='true'>→</span>
              {{rule.reference}}
            </li>
          {{/each}}
        </ul>
      </Alert>
    </div>
  {{/if}}
  <style scoped>
    .dangling-routing-warning {
      margin-bottom: var(--boxel-sp-lg);
    }
    .rules {
      margin: var(--boxel-sp-2xs) 0 0;
      padding-inline-start: var(--boxel-sp);
    }
    .rules li {
      overflow-wrap: break-word;
    }
  </style>
</template>;

export default DanglingRoutingWarning;
