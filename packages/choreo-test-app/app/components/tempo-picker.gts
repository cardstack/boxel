import { on } from '@ember/modifier';
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
 */
export const TempoPicker = <template>
  <label class="tempo">
    <span class="tempo-label">Transition</span>
    <select
      class="tempo-select"
      aria-label="Page transition"
      {{on "change" choose}}
    >
      <option value="instant" selected={{if (is "instant") true}}>
        Instant
      </option>
      <option value="smooth" selected={{if (is "smooth") true}}>Smooth</option>
      <option value="slow" selected={{if (is "slow") true}}>Slow-mo</option>
      <option value="crawl" selected={{if (is "crawl") true}}>
        Super slow-mo
      </option>
      <option value="code">{{if
          settings.showCode
          "Hide how this works"
          "Show how this works"
        }}</option>
    </select>
  </label>
</template>;
