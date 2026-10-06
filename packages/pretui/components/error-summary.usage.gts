// Pretui — ErrorSummary usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Input } from './input';
import { Select } from './select';
import { Form } from './form';
import { ACCOUNT_ISSUES, RATINGS } from '../demo-forms-core';

// ── ErrorSummary ─────────────────────────────────────────────────────────
// Neither reference ships one as a component; the shape is the GOV.UK /
// React Spectrum error-summary pattern. Dropped from that pattern: the
// href="#id" anchors — inside a Boxel card the URL belongs to the card, so a
// fragment jump is a navigation rather than a focus move. Buttons land focus
// on exactly the same element.
class ErrorSummaryUsage extends Component {
  @tracked showAdvisory = false;
  @tracked headingLevel = 3;
  @tracked always = true;
  @tracked announce = false;
  @tracked claimWebsite = true;

  @tracked website = '';
  @tracked rating = 'hot';

  setShowAdvisory = (v: boolean) => (this.showAdvisory = v);
  setHeadingLevel = (v: number | null) => (this.headingLevel = v ?? 3);
  setAlways = (v: boolean) => (this.always = v);
  setAnnounce = (v: boolean) => (this.announce = v);
  setClaimWebsite = (v: boolean) => (this.claimWebsite = v);
  setWebsite = (v: string) => (this.website = v);
  setRating = (v: string) => (this.rating = v);

  issues = ACCOUNT_ISSUES;
  ratingOptions = RATINGS;

  get usage() {
    let bits: string[] = [];
    if (this.showAdvisory) bits.push('@showAdvisory={{true}}');
    if (this.headingLevel !== 3)
      bits.push(`@headingLevel={{${this.headingLevel}}}`);
    if (this.always) bits.push('@always={{true}}');
    if (this.announce) bits.push('@announce={{true}}');
    return `<form.Summary ${bits.join(' ')} />`;
  }

  <template>
    <FreestyleUsage
      @name='ErrorSummary'
      @description="The form-level list, and the reason nothing gets dropped. Every issue the form holds appears here; an issue whose targetPath matched NO rendered field is marked 'no field on this form' rather than filtered away, because a dropped error is worse than an ugly one. Turn off 'claim the Website path' below to watch a routed row become an unrouted one. It takes focus on a refused submit — which is how it announces — so it is deliberately NOT built on Alert, whose hardcoded role='alert'/'status' would re-announce the whole list on every keystroke and double-announce at submit. Rows are buttons, not anchors: they move focus without touching the card's URL."
      @source={{this.usage}}
    >
      <:example>
        <div class='demo-forms-summarystage'>
          <Form @mode='live' @issues={{this.issues}} @label='Account issues' as |form|>
            <form.Summary
              @showAdvisory={{this.showAdvisory}}
              @headingLevel={{this.headingLevel}}
              @always={{this.always}}
              @announce={{this.announce}}
            >
              Fix these before Wuyi Origins can clear purchasing approval.
            </form.Summary>
            {{#if this.claimWebsite}}
              <form.Field @label='Website' @path='Website' @required={{true}}>
                <:control as |c|>
                  <Input
                    @controlId={{c.id}}
                    @value={{this.website}}
                    @placeholder='https://'
                    @onInput={{this.setWebsite}}
                    aria-describedby={{c.describedBy}}
                    aria-invalid={{if c.invalid 'true'}}
                  />
                </:control>
              </form.Field>
            {{/if}}
            <form.Field @label='Rating' @path='Rating'>
              <:control as |c|>
                <Select
                  @controlId={{c.id}}
                  @options={{this.ratingOptions}}
                  @value={{this.rating}}
                  @onValueChange={{this.setRating}}
                />
              </:control>
            </form.Field>
          </Form>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='claimWebsite'
          @defaultValue={{true}}
          @value={{this.claimWebsite}}
          @description="Demo knob: removes the Website field from the form. Its error immediately re-renders as unrouted — the behavior that proves nothing is swallowed."
          @onInput={{this.setClaimWebsite}}
        />
        <Args.Bool
          @name='showAdvisory'
          @defaultValue={{false}}
          @value={{this.showAdvisory}}
          @description='Include warnings and info alongside errors, in severity order.'
          @onInput={{this.setShowAdvisory}}
        />
        <Args.Number
          @name='headingLevel'
          @defaultValue={{3}}
          @value={{this.headingLevel}}
          @description="aria-level for the heading. A card cannot know its host's outline, so the level is a knob rather than a hardcoded <h2>."
          @onInput={{this.setHeadingLevel}}
        />
        <Args.Bool
          @name='always'
          @defaultValue={{false}}
          @value={{this.always}}
          @description='Render before a submit has been attempted. Without it a submit-mode form stays quiet until the user tries to commit.'
          @onInput={{this.setAlways}}
        />
        <Args.Bool
          @name='announce'
          @defaultValue={{false}}
          @value={{this.announce}}
          @description="Add role='alert'. Off by default: the summary announces by taking focus, and a live region on top of that double-announces."
          @onInput={{this.setAnnounce}}
        />
        <Args.String
          @name='title'
          @description='Heading text. Defaults to a count sentence — "There are 3 issues to fix".'
        />
        <Args.Object
          @name='issues'
          @description='Issues to summarise when used WITHOUT a Form. With a form, its list is used and unrouted issues can be detected.'
        />
        <Args.Object
          @name='form'
          @description='The owning FormContext. Supplied automatically by form.Summary.'
        />
        <Args.Yield
          @description='Optional intro line between the heading and the list.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-forms-summarystage {
        max-width: 34rem;
        width: 100%;
      }
    </style>
  </template>
}

export const DEMOS_ERROR_SUMMARY: Record<string, unknown> = {
  ErrorSummary: ErrorSummaryUsage,
};
