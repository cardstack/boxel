// Pretui — Stat usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Stat } from './stat';
import { PRETUI_TONES } from '../pretui-primitives';

const TONES = [...PRETUI_TONES];

const StatUsage: TemplateOnlyComponent = <template>
    <FreestyleUsage @name='Stat' @description='A KPI headline that composes locale-aware rolling digits with a signed textual delta and comparison window.' @source='<Stat @label="Approved lots" @value={{1482}} @delta={{12}} … />'>
      <:example><div class='stat-grid'><Stat @label='Approved lots' @value={{1482}} @delta={{12}} @hint='vs spring' @minDigits={{5}} /><Stat @label='Reserve value' @value={{286400}} @style='currency' @currency='USD' @delta={{-3}} @hint='vs estimate' /></div><div class='stat-grid'><Stat @tone='success' @label='On track' @value={{42}} @hint='hires on plan' @roll={{false}} /><Stat @tone='warning' @label='At risk' @value={{7}} @hint='offers stalled' @roll={{false}} /><Stat @tone='danger' @label='Blocked' @value={{3}} @hint='awaiting approval' @roll={{false}} /></div></:example>
      <:api as |Args|><Args.String @name='label' @value='Approved lots' /><Args.String @name='tone' @description='opt-in status dot before the label, in a Chip tone' @options={{TONES}} /><Args.Number @name='value' @value={{1482}} /><Args.Number @name='delta' @value={{12}} /><Args.String @name='hint' @value='vs spring' /><Args.Bool @name='roll' @defaultValue={{true}} /></:api>
    </FreestyleUsage>
    <style scoped>.stat-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-8, 34px); }</style>
  </template>;

export const DEMOS_STAT: Record<string, unknown> = {
  Stat: StatUsage,
};
