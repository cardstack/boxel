import { modifier } from 'ember-modifier';
import { restartableTask, timeout } from 'ember-concurrency';
import { TrackedArray } from 'tracked-built-ins';
import { format } from 'date-fns';
import { uniq } from 'lodash-es';
import {
  CardDef,
  Component as CardComponent,
  field,
  contains,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// Every import above is a package the host shims onto the virtual
// network, so a card may use it and run. Exercising the values (not just
// importing them) keeps this honest: an import alone still type-checks
// against a module resolved as `any`, which is the failure the bundled
// declarations exist to prevent.
const markReady = modifier((element: HTMLElement) => {
  element.setAttribute('data-ready', 'true');
});

export class TelemetryLog extends CardDef {
  static displayName = 'Telemetry Log';
  @field source = contains(StringField);

  static isolated = class Isolated extends CardComponent<typeof TelemetryLog> {
    entries = new TrackedArray<string>(uniq(['boot', 'boot', 'ready']));
    capturedOn = format(new Date(), 'yyyy-MM-dd');

    refresh = restartableTask(async () => {
      await timeout(10);
      this.entries.push('refreshed');
    });

    <template>
      <section {{markReady}}>
        <h2>{{@model.source}}</h2>
        <p>{{this.capturedOn}}</p>
        {{#each this.entries as |entry|}}
          <li>{{entry}}</li>
        {{/each}}
      </section>
    </template>
  };
}
