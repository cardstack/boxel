import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { KnownDate, type KnownDateResult } from './controls-known-date.gts';

export class KnownDateDemo extends Component {
  @tracked selected = '1990-04-15';
  @tracked verdict = 'Ready for a known date';

  update = (iso: string | undefined, result: KnownDateResult) => {
    this.selected = iso ?? '';
    this.verdict = iso
      ? 'Accepted as ' + iso
      : result.empty
        ? 'Ready for a known date'
        : result.issue ?? 'Keep typing';
  };

  <template>
    <section class='known-date-demo'>
      <header>
        <span class='eyebrow'>PRETUI · INPUTS · 0.4.0</span>
        <h1>A date somebody already knows.</h1>
        <p>Type a birthday, issue date, or expiry without paging through a calendar.</p>
      </header>
      <div class='stage'>
        <KnownDate
          @label='When was the lot harvested?'
          @hint='Try 27 3 2007, March, or paste 2007-03-27 into any box.'
          @locale='en-GB'
          @reference='2026-08-23'
          @value='1990-04-15'
          @min='1900-01-01'
          @max='2099-12-31'
          @onChange={{this.update}}
        />
      </div>
      <footer>
        <span>Deterministic reference</span>
        <strong>{{this.verdict}}</strong>
      </footer>
    </section>
    <style scoped>
      .known-date-demo { --primary: #00a884; --foreground: #272330; --field: #fff; display: grid; gap: 1.5rem; max-width: 46rem; padding: 2rem; border: 1px solid #dedde3; border-radius: 1.25rem; background: linear-gradient(145deg, #fbfbf8, #f2f6f3); color: var(--foreground); box-shadow: 0 1.25rem 3rem rgb(39 35 48 / 10%); font-family: 'IBM Plex Sans', system-ui, sans-serif; }
      header { display: grid; gap: .4rem; } .eyebrow { color: #007c63; font: 700 .7rem/1.2 ui-monospace, monospace; letter-spacing: .12em; } h1 { margin: 0; font-size: clamp(1.6rem, 4vw, 2.5rem); letter-spacing: -.04em; } p { max-width: 36rem; margin: 0; color: #67636f; line-height: 1.55; }
      .stage { padding: 1.5rem; border-radius: 1rem; background: rgb(255 255 255 / 86%); box-shadow: inset 0 0 0 1px rgb(39 35 48 / 8%); }
      footer { display: flex; justify-content: space-between; gap: 1rem; padding-top: 1rem; border-top: 1px solid #dedde3; color: #76717d; font: .75rem/1.4 ui-monospace, monospace; } footer strong { color: #007c63; text-align: right; }
    </style>
  </template>
}
