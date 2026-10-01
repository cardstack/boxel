// Pretui — Tour usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { FreestyleUsage } from './freestyle-usage';
import { Tour } from './tour';
import type { TourStep } from './tour';
import { Button } from './button';
import { Input } from './input';

const STEPS: TourStep[] = [
  { id: 'search', title: 'Find a lot', body: 'Search by farm, region or process.', target: '.tr-demo-search' },
  { id: 'roast', title: 'Start a roast', body: 'Pick a profile, then press Start. The curve records itself.', target: '.tr-demo-start', placement: 'top' },
  { id: 'done', title: 'You are set', body: 'Replay this tour any time from Help.' },
];

export class TourUsage extends Component {
  steps = STEPS;
  @tracked open = false;
  @tracked modal = false;
  show = () => (this.open = true);
  setOpen = (v: boolean) => (this.open = v);
  setModal = (v: boolean) => (this.modal = v);
  get usage() {
    return "<Tour @steps={{this.steps}} @open={{this.touring}} @onOpenChange={{this.setTouring}} />";
  }
  <template>
    <FreestyleUsage
      @name='Tour'
      @description='An in-product walkthrough: one card per step, anchored to the real control it explains, with a ring around it. The card is a non-modal dialog; Next takes focus each step, Escape skips, and focus returns to where it was. Onboarding is a first-run scene; Tour is attached to the live UI.'
      @source={{this.usage}}
    >
      <:example>
        <div class='tr-demo'>
          <Input class='tr-demo-search' aria-label='Search lots' @placeholder='Search lots' />
          <Button class='tr-demo-start' @appearance='accent'>Start roast</Button>
          <Button @appearance='outlined' {{on 'click' this.show}}>Take the tour</Button>
        </div>
        <Tour @steps={{this.steps}} @open={{this.open}} @onOpenChange={{this.setOpen}} @modal={{this.modal}} />
      </:example>
      <:api as |Args|>
        <Args.Object @name='steps' @required={{true}} @description='{ id, title, body, target?, placement? }[]; target is a CSS selector.' />
        <Args.Bool @name='open' @description='Controlled; defaultOpen seeds the uncontrolled form.' />
        <Args.Action @name='onOpenChange' />
        <Args.Number @name='index' @description='Controlled step index.' />
        <Args.Action @name='onIndexChange' />
        <Args.Action @name='onFinish' @description='Done on the last step.' />
        <Args.Action @name='onSkip' @description='Skip, the close button or Escape.' />
        <Args.Bool @name='modal' @value={{this.modal}} @defaultValue={{false}} @onInput={{this.setModal}} @description='Dim everything but the target.' />
        <Args.String @name='nextLabel' @defaultValue='Next' />
        <Args.String @name='backLabel' @defaultValue='Back' />
        <Args.String @name='doneLabel' @defaultValue='Done' />
        <Args.String @name='skipLabel' @defaultValue='Skip tour' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .tr-demo {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3, 0.5rem);
        padding: var(--space-6, 1.25rem) var(--space-4, 0.6875rem);
      }
    </style>
  </template>
}

export const DEMOS_TOUR: Record<string, unknown> = {
  Tour: TourUsage,
};
