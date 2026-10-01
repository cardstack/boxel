// Pretui — LoadingOverlay usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { LoadingOverlay } from './loading-overlay';
import { Input } from './input';
import { Button } from './button';

export class LoadingOverlayUsage extends Component {
  @tracked open = true;
  @tracked label = 'Saving billing details';
  @tracked showLabel = true;
  @tracked blur = false;
  @tracked lock = true;
  @tracked accountName = 'Northwind Roasters';
  setOpen = (v: boolean) => (this.open = v);
  setLabel = (v: string) => (this.label = v);
  setShowLabel = (v: boolean) => (this.showLabel = v);
  setBlur = (v: boolean) => (this.blur = v);
  setLock = (v: boolean) => (this.lock = v);
  setAccountName = (v: string) => (this.accountName = v);
  get usage() {
    let bits = [`@open={{${this.open}}}`, `@label='${this.label}'`];
    if (this.showLabel) bits.push('@showLabel={{true}}');
    if (this.blur) bits.push('@blur={{true}}');
    if (this.lock) bits.push('@lock={{true}}');
    return `<LoadingOverlay ${bits.join(' ')}>\n  …the form…\n</LoadingOverlay>`;
  }
  <template>
    <FreestyleUsage
      @name='LoadingOverlay'
      @description='A scrim and spinner over a region whose content stays mounted, so nothing reflows when loading starts or stops. The region is aria-busy while open, and @lock makes the content inert so a half-saved form cannot be edited. Skeleton is for content that does not exist yet; Spinner is inline.'
      @source={{this.usage}}
    >
      <:example>
        <LoadingOverlay
          @open={{this.open}}
          @label={{this.label}}
          @showLabel={{this.showLabel}}
          @blur={{this.blur}}
          @lock={{this.lock}}
        >
          <div class='lo-demo-form'>
            <Input @value={{this.accountName}} @onInput={{this.setAccountName}} aria-label='Account name' />
            <Input @value='accounts@northwind.example' aria-label='Billing email' />
            <Button @appearance='accent'>Save</Button>
          </div>
        </LoadingOverlay>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='open'
          @defaultValue={{false}}
          @value={{this.open}}
          @description='Show the overlay. The content underneath renders either way.'
          @onInput={{this.setOpen}}
        />
        <Args.String
          @name='label'
          @defaultValue='Loading'
          @value={{this.label}}
          @description='What is loading. Announced through the status region whether or not it is painted.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='showLabel'
          @defaultValue={{false}}
          @value={{this.showLabel}}
          @description='Paint the label under the spinner.'
          @onInput={{this.setShowLabel}}
        />
        <Args.Bool
          @name='blur'
          @defaultValue={{false}}
          @value={{this.blur}}
          @description='Frost the content under the scrim instead of only tinting it.'
          @onInput={{this.setBlur}}
        />
        <Args.Bool
          @name='lock'
          @defaultValue={{false}}
          @value={{this.lock}}
          @description='Make the content inert while open: out of the tab order and the accessibility tree.'
          @onInput={{this.setLock}}
        />
        <Args.Yield @name='default' @description='The region being loaded. It stays mounted.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .lo-demo-form {
        display: grid;
        gap: var(--space-2, 0.5rem);
        padding: var(--space-4, 1rem);
        max-inline-size: 22rem;
      }
    </style>
  </template>
}

export const DEMOS_LOADING_OVERLAY: Record<string, unknown> = {
  LoadingOverlay: LoadingOverlayUsage,
};
