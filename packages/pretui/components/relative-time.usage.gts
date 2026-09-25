// Pretui — RelativeTime usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { RelativeTime } from './relative-time';

// ── RelativeTime — from webawesome's relative-time semantics ──────────────
const RT_FORMAT_OPTIONS = ['long', 'short', 'narrow'];

const RT_NUMERIC_OPTIONS = ['auto', 'always'];

// Dropped knobs: sync (webawesome's auto-tick timer — the realm forbids
// timers, so the phrase computes once from @date vs @now and @now is
// caller-supplied per the LoadingState precedent), display (no absolute-date
// fallback mode), lang (locale fixed to en-US like the rest of the kit).
class RelativeTimeUsage extends GlimmerComponent {
  @tracked date = '2026-08-11T09:30:00';
  @tracked now = '2026-08-12T12:00:00';
  @tracked format = 'long';
  @tracked numeric = 'auto';
  setDate = (v: string) => (this.date = v);
  setNow = (v: string) => (this.now = v);
  setFormat = (v: string) => (this.format = v);
  setNumeric = (v: string) => (this.numeric = v);
  get formatVal() {
    return this.format as 'long' | 'short' | 'narrow';
  }
  get numericVal() {
    return this.numeric as 'always' | 'auto';
  }
  get nowVal() {
    return this.now || undefined;
  }
  get usage() {
    return `<RelativeTime @date='${this.date}' @now='${this.now}' />`;
  }
  <template>
    <FreestyleUsage
      @name='RelativeTime'
      @description='Displays a date as a human phrase relative to @now ("yesterday", "in 3 days") via Intl.RelativeTimeFormat, inside a <time> element carrying the ISO datetime and an absolute-date title. Computes once — it does not auto-tick in the realm (no timers); pass a fresh @now to update.'
      @source={{this.usage}}
      @viewportMode='inline'
    >
      <:example>
        <RelativeTime
          @date={{this.date}}
          @now={{this.nowVal}}
          @format={{this.formatVal}}
          @numeric={{this.numericVal}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='date'
          @required={{true}}
          @description='The instant to describe — ISO datetime string (or a Date when invoked from code).'
          @value={{this.date}}
          @onInput={{this.setDate}}
        />
        <Args.String
          @name='now'
          @description='The reference instant — caller-supplied (LoadingState precedent). Omitted, it captures the construction instant and never ticks.'
          @value={{this.now}}
          @onInput={{this.setNow}}
        />
        <Args.String
          @name='format'
          @description="Intl.RelativeTimeFormat style: 'long' (3 days ago), 'short' (3 days ago, abbreviated units), or 'narrow' (3d ago)."
          @options={{RT_FORMAT_OPTIONS}}
          @defaultValue='long'
          @value={{this.format}}
          @onInput={{this.setFormat}}
        />
        <Args.String
          @name='numeric'
          @description="'auto' allows phrases like 'yesterday'; 'always' forces '1 day ago'."
          @options={{RT_NUMERIC_OPTIONS}}
          @defaultValue='auto'
          @value={{this.numeric}}
          @onInput={{this.setNumeric}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RELATIVE_TIME: Record<string, unknown> = {
  RelativeTime: RelativeTimeUsage,
};
