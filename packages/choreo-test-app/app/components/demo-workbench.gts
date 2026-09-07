import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  createDialKit,
  createDialRoot,
  type DialConfig,
  DialStore,
  type DialValue,
} from 'dialkit/vanilla';
import { modifier } from 'ember-modifier';
import { postRender } from 'glimmer-motion';
import SagradaFilm from 'test-app/components/sagrada-film';
import { SylvaStage } from 'test-app/components/sylva-stage';
import TowerFilm from 'test-app/components/tower-film';
import type { DemoEntry } from 'test-app/lib/catalog';
import { demoPresets } from 'test-app/lib/demo-presets';
import { demoTuning } from 'test-app/lib/demo-tuning';
import {
  captureDemoMotion,
  refreshDemoMotion,
} from 'test-app/lib/live-demo-motion';
import { theme } from 'test-app/lib/theme';

interface Signature {
  Args: { demo: DemoEntry; embedded?: boolean };
}
export class DemoWorkbench extends Component<Signature> {
  @tracked iteration = 0;
  @tracked controlsOpen = true;
  replay = () => {
    this.iteration++;
  };
  toggleControls = () => {
    this.controlsOpen = !this.controlsOpen;
  };
  is = (id: string) => this.args.demo.id === id;

  mount = modifier((element: HTMLElement, [id]: [string]) => {
    const state = demoTuning(id);
    const root = createDialRoot({
      target: element,
      mode: 'inline',
      theme: theme.mode === 'auto' ? 'system' : theme.mode,
      productionEnabled: true,
    });
    const config = (): DialConfig => ({
      ...state.definitions,
      replay: { type: 'action', label: 'Replay / reset demo' },
      restore: { type: 'action', label: 'Restore demo defaults' },
    });
    const kit = createDialKit(this.args.demo.title, config(), {
      onAction: (action) => {
        if (action === 'restore') {
          kit.resetValues();
          if (id === 'drift') {
            DialStore.resetValues('drift-car');
          }
          if (id === 'hang') {
            DialStore.resetValues('hang-slide');
          }
        }
        this.replay();
      },
    });
    let seeding = false;
    const seeded = new Set<string>();
    const seedPresets = () => {
      const ready = (demoPresets[id] ?? []).filter(
        (preset) =>
          !seeded.has(preset.name) &&
          Object.keys(preset.values).every((key) => key in state.definitions)
      );
      if (!ready.length) {
        return;
      }
      seeding = true;
      const previous = kit.getValues();
      const active = DialStore.getActivePresetId(kit.id);
      for (const preset of ready) {
        kit.resetValues();
        kit.setValues(preset.values);
        DialStore.savePreset(kit.id, preset.name);
        seeded.add(preset.name);
      }
      kit.resetValues();
      if (active) {
        DialStore.loadPreset(kit.id, active);
      } else {
        DialStore.clearActivePreset(kit.id);
      }
      kit.setValues(previous);
      seeding = false;
    };
    seedPresets();
    let gone = false;
    let pendingMotion: ReturnType<typeof captureDemoMotion> | null = null;
    const refresh = () => {
      if (!gone) {
        kit.updateConfig(config());
        seedPresets();
      }
    };
    state.listeners.add(refresh);
    const stop = kit.subscribe((values) => {
      if (seeding) {
        return;
      }
      queueMicrotask(() => {
        const changed: Record<string, DialValue> = {};
        for (const [key, value] of Object.entries(values)) {
          const definition = state.definitions[key];
          if (definition === undefined) {
            continue;
          }
          const baseline = Array.isArray(definition)
            ? definition[0]
            : definition;
          const same =
            baseline &&
            typeof baseline === 'object' &&
            value &&
            typeof value === 'object'
              ? Object.entries(baseline).every(
                  ([k, v]) =>
                    JSON.stringify((value as Record<string, unknown>)[k]) ===
                    JSON.stringify(v)
                )
              : baseline === value;
          if (!same) {
            changed[key] = value as DialValue;
          }
        }
        if (!gone && JSON.stringify(state.values) !== JSON.stringify(changed)) {
          const scheduleRefresh = !pendingMotion;
          pendingMotion ??= captureDemoMotion(
            element
              .closest('.demo-workbench')
              ?.querySelector('.workbench-stage') ?? null
          );
          state.values = changed;
          if (scheduleRefresh) {
            postRender(() => {
              const running = pendingMotion;
              pendingMotion = null;
              if (!gone && running) {
                refreshDemoMotion(running);
              }
            });
          }
        }
      });
    });
    return () => {
      gone = true;
      state.listeners.delete(refresh);
      stop();
      kit.destroy();
      root.destroy();
      state.values = {};
    };
  });

  <template>
    <section
      class="demo-workbench {{if @embedded 'is-embedded'}}"
      data-demo-parameters={{@demo.id}}
      data-test-demo-workbench
    >
      <div class="workbench-toolbar"><span>LIVE / {{@demo.title}}</span><button
          type="button"
          {{on "click" this.replay}}
        >Replay ↻</button><button
          type="button"
          aria-expanded={{this.controlsOpen}}
          {{on "click" this.toggleControls}}
        >Tune {{if this.controlsOpen "−" "+"}}</button></div>
      <div class="workbench-body {{if this.controlsOpen 'with-controls'}}">
        <div class="workbench-viewport"><div class="workbench-stage">{{#each
              (array this.iteration) key="@identity"
            }}{{#let @demo.Example as |Example|}}{{#if
                  (this.is "towers")
                }}<TowerFilm @embed={{true}} />{{else if
                  (this.is "sagrada")
                }}<SagradaFilm @embed={{true}} />{{else if
                  (this.is "sylva")
                }}<SylvaStage @theater={{true}} />{{else}}<Example
                  />{{/if}}{{/let}}{{/each}}</div></div>
        <aside
          class="workbench-dials"
          hidden={{unless this.controlsOpen true}}
          aria-label="Live demo parameters"
        ><div {{this.mount @demo.id}}></div><p>These variables feed the live
            demo. Timing edits update running motion; target edits update the
            current interaction.</p></aside>
      </div>
      {{#unless @embedded}}<p class="workbench-help">Adjust the demo’s live
          variables. Use DialKit’s + to save a version or Copy to keep your
          settings.
          <LinkTo @route="docs.topic" @model="interactive-timelines">Read the
            guide →</LinkTo></p>{{/unless}}
    </section>
  </template>
}
