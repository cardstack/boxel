import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { on } from '@ember/modifier';
import SaveCardCommand from '@cardstack/boxel-host/tools/save-card';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/tools/send-request-via-proxy';

type SaveResult<T = any> = {
  card: T;
  saved: Promise<T>;
};

class OptimisticSave {
  pending: Array<Promise<any>> = [];
  readonly commandContext: any;

  constructor(commandContext: any) {
    this.commandContext = commandContext;
  }

  save<T = any>(card: T, realm: string): SaveResult<T> {
    let command = new SaveCardCommand(this.commandContext);
    let saved = command
      .execute({ card: card as any, realm })
      .then((persisted: any) => (persisted ?? card) as T);

    this.pending.push(saved);
    saved.catch(() => {});
    return { card, saved };
  }

  settle() {
    let pending = this.pending.slice();
    this.pending = [];
    return Promise.allSettled(pending);
  }
}

class PipelineStep extends FieldDef {
  @field name = contains(StringField);
  @field status = contains(StringField); // pending | running | completed | failed
  @field notes = contains(StringField);
  @field latencyMs = contains(NumberField);
}

class PipelineLog extends FieldDef {
  @field at = contains(DatetimeField);
  @field level = contains(StringField);
  @field message = contains(StringField);
}

export class PipelineRun extends CardDef {
  static displayName = 'Pipeline Run';

  @field status = contains(StringField); // running | completed | failed
  @field progressCurrent = contains(NumberField);
  @field progressTotal = contains(NumberField);
  @field currentStepIndex = contains(NumberField);
  @field startedAt = contains(DatetimeField);
  @field completedAt = contains(DatetimeField);
  @field promptSnapshot = contains(StringField);
  @field outputText = contains(StringField);
  @field steps = containsMany(PipelineStep);
  @field logs = containsMany(PipelineLog);
}

export class PipelineLauncher extends CardDef {
  static displayName = 'Pipeline Launcher';

  @field prompt = contains(StringField);
  @field latestRunUrl = contains(StringField);

  static isolated = class extends Component<typeof PipelineLauncher> {
    @tracked status: 'idle' | 'running' | 'completed' | 'failed' = 'idle';
    @tracked message = '';

    runPipeline = restartableTask(async () => {
      this.status = 'running';
      this.message = '';

      let cx = this.args.context?.commandContext;
      let realm = (this.args.model as any)?.[realmURL]?.href;
      if (!cx || !realm) {
        this.status = 'failed';
        this.message = 'Missing command context or realm URL.';
        return;
      }

      let opt = new OptimisticSave(cx);
      let startedAt = new Date();
      let run = new PipelineRun({
        status: 'running',
        progressCurrent: 0,
        progressTotal: 3,
        currentStepIndex: 0,
        startedAt,
        promptSnapshot: this.args.model.prompt ?? '',
        steps: [
          new PipelineStep({ name: 'Create run', status: 'completed' }),
          new PipelineStep({ name: 'Call model', status: 'pending' }),
          new PipelineStep({ name: 'Save result', status: 'pending' }),
        ],
        logs: [
          new PipelineLog({
            at: startedAt,
            level: 'info',
            message: 'run created',
          }),
        ],
      } as any);

      let firstSave = opt.save(run, realm).saved;
      firstSave.then((saved: any) => {
        this.args.model.latestRunUrl = saved?.id ?? (run as any).id ?? '';
      });

      try {
        run.currentStepIndex = 1;
        run.progressCurrent = 1;
        run.steps = [
          run.steps[0],
          new PipelineStep({ name: 'Call model', status: 'running' }),
          run.steps[2],
        ];
        run.logs = [
          ...run.logs,
          new PipelineLog({
            at: new Date(),
            level: 'info',
            message: 'calling model',
          }),
        ];
        opt.save(run, realm);

        let request = new SendRequestViaProxyCommand(cx);
        let result = await request.execute({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          method: 'POST',
          requestBody: JSON.stringify({
            model: 'anthropic/claude-haiku-4.5',
            messages: [{ role: 'user', content: this.args.model.prompt ?? '' }],
          }),
        });
        if (!result.response.ok) {
          throw new Error(`model request failed: ${result.response.status}`);
        }
        let data = await result.response.json();
        let output = data?.choices?.[0]?.message?.content ?? '';

        run.currentStepIndex = 3;
        run.progressCurrent = 3;
        run.status = 'completed';
        run.completedAt = new Date();
        run.outputText = String(output);
        run.steps = [
          run.steps[0],
          new PipelineStep({ name: 'Call model', status: 'completed' }),
          new PipelineStep({ name: 'Save result', status: 'completed' }),
        ];
        run.logs = [
          ...run.logs,
          new PipelineLog({
            at: new Date(),
            level: 'info',
            message: 'pipeline completed',
          }),
        ];
        opt.save(run, realm);

        this.status = 'completed';
        this.message = 'Pipeline completed.';
        let settled = await opt.settle();
        let failures = settled.filter((item) => item.status === 'rejected');
        if (failures.length > 0) {
          this.message = `Pipeline completed; ${failures.length} save(s) failed later.`;
        }
      } catch (err: any) {
        run.status = 'failed';
        run.completedAt = new Date();
        run.logs = [
          ...run.logs,
          new PipelineLog({
            at: new Date(),
            level: 'error',
            message: err?.message ?? String(err),
          }),
        ];
        opt.save(run, realm);
        this.status = 'failed';
        this.message = err?.message ?? String(err);
      }
    });

    <template>
      <article>
        <h2>{{@model.cardTitle}}</h2>
        <p>{{@model.prompt}}</p>
        <button
          type='button'
          disabled={{this.runPipeline.isRunning}}
          {{on 'click' (perform this.runPipeline)}}
        >
          {{#if this.runPipeline.isRunning}}Running{{else}}Run pipeline{{/if}}
        </button>
        {{#if this.message}}<p>{{this.message}}</p>{{/if}}
        {{#if @model.latestRunUrl}}
          <p><a href={{@model.latestRunUrl}}>Open latest run</a></p>
        {{/if}}
      </article>
    </template>
  };
}
