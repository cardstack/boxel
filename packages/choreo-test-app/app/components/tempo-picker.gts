import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { beacon } from 'glimmer-motion';
import { setTempo, settings, type Tempo, toggleCode } from 'test-app/lib/tempo';

function is(value: Tempo) {
  return settings.tempo === value;
}
function label() {
  return { instant: 'Instant', smooth: 'Smooth', slow: 'Slow-mo' }[
    settings.tempo
  ];
}
function choose(value: Tempo, event: Event) {
  setTempo(value);
  (event.currentTarget as HTMLElement)
    .closest('details')
    ?.removeAttribute('open');
}
function dismiss(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    const menu = event.currentTarget as HTMLDetailsElement;
    menu.removeAttribute('open');
    menu.querySelector('summary')?.focus();
  }
}
export const TempoPicker = <template>
  <details
    name="header-preferences"
    class="header-picker"
    {{on "keydown" dismiss}}
  >
    <summary
      class="header-picker-pill"
      aria-label="Navigation"
      title="Navigation"
      {{beacon "transition-control"}}
    >
      <span aria-hidden="true" class="header-picker-icon">↗</span>
      <span>{{label}}</span><span
        aria-hidden="true"
        class="header-picker-chevron"
      >⌄</span>
    </summary>
    <div class="header-picker-menu">
      <span class="header-picker-label">Page transition speed</span>
      <div class="header-picker-segments" role="group" aria-label="Navigation">
        <button
          type="button"
          aria-pressed={{is "instant"}}
          {{on "click" (fn choose "instant")}}
        >Instant</button>
        <button
          type="button"
          aria-pressed={{is "smooth"}}
          {{on "click" (fn choose "smooth")}}
        >Smooth</button>
        <button
          type="button"
          aria-pressed={{is "slow"}}
          {{on "click" (fn choose "slow")}}
        >Slow-mo</button>
      </div>
      <button
        type="button"
        class="header-picker-help"
        {{on "click" toggleCode}}
      >{{if
          settings.showCode
          "Hide how this works"
          "Show how this works"
        }}</button>
    </div>
  </details>
</template>;
