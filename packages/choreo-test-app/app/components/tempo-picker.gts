import { on } from '@ember/modifier';
import { beacon } from 'glimmer-motion';
import { setTempo, settings, type Tempo, toggleCode } from 'test-app/lib/tempo';

function choose(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value === 'code') {
    toggleCode();
    // not a mode: put the control back to whatever speed is actually set
    select.value = settings.tempo;
    return;
  }
  setTempo(select.value as Tempo);
}

function is(mode: string) {
  return settings.tempo === mode;
}

/**
 * The page transition: how fast, and what it is made of.
 *
 * "How this works" is not a speed, so picking it opens the panel and puts the
 * control back where it was rather than pretending to be a fourth setting.
 *
 * The beacon is why the panel appears to come OUT of this control: it claims
 * this box by name, and <HowPanel>'s Choreo borrows it as the start of the
 * flight in and the end of the flight out. The select itself never animates —
 * a beacon is a point, not a participant.
 */
export const TempoPicker = <template>
  <label class="tempo">
    <span class="tempo-label">Transition</span>
    {{! Narrow screens only (see the stylesheet). A native <select> sizes
        itself to its LONGEST option, and "Show how this works" made this
        control wide enough to squeeze the wordmark down to "C…". On mobile
        the select goes transparent and sits on top of this icon, so the tap
        target and the native picker are untouched — only the label is. }}
    {{! lucide "gauge" }}
    <svg class="tempo-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
    <select
      class="tempo-select"
      aria-label="Page transition"
      {{beacon "transition-control"}}
      {{on "change" choose}}
    >
      <option value="instant" selected={{if (is "instant") true}}>
        Instant
      </option>
      <option value="smooth" selected={{if (is "smooth") true}}>Smooth</option>
      <option value="slow" selected={{if (is "slow") true}}>Slow-mo</option>
      <option value="code">{{if
          settings.showCode
          "Hide how this works"
          "Show how this works"
        }}</option>
    </select>
  </label>
</template>;
