// Pretui — Result usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Result } from './result';
import type { ResultStatus } from './result';
import { Button } from './button';

const STATUS_OPTIONS = ['success', 'info', 'warning', 'danger', '403', '404', '500'];

export class ResultUsage extends Component {
  statusOptions = STATUS_OPTIONS;
  @tracked status = 'success';
  @tracked title = 'Order placed';
  @tracked description = 'Lot 7 ships Thursday. A receipt is on its way to accounts@northwind.example.';
  @tracked showExtra = true;
  setStatus = (v: string) => (this.status = v);
  setTitle = (v: string) => (this.title = v);
  setDescription = (v: string) => (this.description = v);
  setShowExtra = (v: boolean) => (this.showExtra = v);
  get statusArg() {
    return this.status as ResultStatus;
  }
  get usage() {
    let bits = [`@status='${this.status}'`];
    if (this.title) bits.push(`@title='${this.title}'`);
    if (this.description) bits.push(`@description='…'`);
    let extra = this.showExtra ? `\n  <:extra><Button>View order</Button></:extra>\n` : '';
    return `<Result ${bits.join(' ')}>${extra}</Result>`;
  }
  <template>
    <FreestyleUsage
      @name='Result'
      @description='The scene that replaces a pane once an outcome is known: a submitted form, a missing page, a refused request. One heading, one explanation, the ways forward. HTTP codes render as their numerals. EmptyState is a region with no data yet; Alert is an inline message.'
      @source={{this.usage}}
    >
      <:example>
        <Result @status={{this.statusArg}} @title={{this.title}} @description={{this.description}}>
          <:extra>
            {{#if this.showExtra}}
              <Button @appearance='accent'>View order</Button>
              <Button @appearance='outlined'>Back to lots</Button>
            {{/if}}
          </:extra>
        </Result>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='status'
          @value={{this.status}}
          @options={{this.statusOptions}}
          @defaultValue='info'
          @description='The outcome. Codes pick a hue and a default title; tone spellings like error and positive resolve too.'
          @onInput={{this.setStatus}}
        />
        <Args.String
          @name='title'
          @value={{this.title}}
          @description='The heading. Clear it to see the default a code gets.'
          @onInput={{this.setTitle}}
        />
        <Args.String
          @name='description'
          @value={{this.description}}
          @description='What it means for the reader, and what to do next.'
          @onInput={{this.setDescription}}
        />
        <Args.Number @name='headingLevel' @defaultValue={{2}} @description='The heading level of the title.' />
        <Args.Bool
          @name='extra'
          @value={{this.showExtra}}
          @description='Toggle the actions block in this demo.'
          @onInput={{this.setShowExtra}}
        />
        <Args.Yield @name='icon' @description='Replaces the status glyph.' />
        <Args.Yield @name='default' @description='Detail between the description and the actions.' />
        <Args.Yield @name='extra' @description='The ways forward, usually one or two Buttons.' />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RESULT: Record<string, unknown> = {
  Result: ResultUsage,
};
