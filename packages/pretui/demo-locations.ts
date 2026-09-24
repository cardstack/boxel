// Pretui — where each component's usage page and examples live, loaded on
// demand.
//
// A page lives at components/<kebab-name>.usage unless DEMO_MODULES names
// another module. Nothing here imports a page: the Spec card loads the one it
// shows when it renders, so the card's import closure stays the modules it
// draws rather than every page and every component they reach.
import type { Loader } from '@cardstack/runtime-common';
import type { ExampleSpec } from './examples-kit';

/** Pages the naming rule does not find: shared usage pages and territory bundles. */
export const DEMO_MODULES: Record<string, string> = {
  AlertDialog: './demo-overlay-confirm',
  AmountInput: './components/money.usage',
  AspectRatio: './demo-structure-layout',
  Calendar: './demo-reading-extras',
  Card: './demo-structure-layout',
  ChannelSlider: './components/color.usage',
  ColorArea: './components/color.usage',
  ColorField: './components/color.usage',
  ColorPalette: './components/color.usage',
  ColorPicker: './components/color.usage',
  ColorStopEditor: './components/color.usage',
  Combobox: './demo-forms-picker',
  CopyButton: './components/extras.usage',
  DatePicker: './demo-reading-extras',
  DateRangePicker: './demo-reading-extras',
  Dropzone: './components/file-intake.usage',
  EditInPlace: './demo-structure-flow',
  EmailInput: './components/extras.usage',
  EmojiButton: './demo-emoji',
  EmojiPicker: './demo-emoji',
  EntityDisplay: './demo-reading-extras',
  FeatureVoting: './demo-agentic-shelf',
  FileTrigger: './components/file-intake.usage',
  GradientEditor: './components/color.usage',
  GraphLayout: './demo-surfaces-canvas',
  InputGroup: './components/extras.usage',
  Label: './components/extras.usage',
  LayerManager: './components/layer-manager.usage',
  MoneyInput: './components/money.usage',
  NumberInput: './components/extras.usage',
  OtpInput: './components/composites.usage',
  PasswordInput: './components/extras.usage',
  PeriodInput: './components/period.usage',
  PhoneInput: './components/extras.usage',
  Picker: './demo-structure-extras',
  PipScale: './components/slider-pips.usage',
  ScrollArea: './demo-structure-shell',
  SearchInput: './components/extras.usage',
  Sidebar: './demo-structure-shell',
  SignaturePad: './demo-capture',
  Stack: './demo-structure-layout',
  Stepper: './components/extras.usage',
  Swatch: './components/color.usage',
  TimeInput: './components/composites.usage',
  ToggleGroup: './components/toggle-controls.usage',
  ToggleMatrix: './components/toggle-controls.usage',
  TokenInput: './demo-design-tools',
  UrlInput: './components/extras.usage',
};

export interface DemoSubject {
  name: string;
  stage?: string;
  tier?: string;
}

function kebabName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The module holding `subject`'s usage page, relative to the realm root, or
 * undefined when it has none to look for. Planned, host and Runtime entries
 * have no page unless DEMO_MODULES names one.
 */
export function demoModuleFor(subject: DemoSubject): string | undefined {
  let named = DEMO_MODULES[subject.name];
  if (named) {
    return named;
  }
  if (
    subject.stage === 'planned' ||
    subject.stage === 'host' ||
    subject.tier === 'Runtime'
  ) {
    return undefined;
  }
  return `./components/${kebabName(subject.name)}.usage`;
}

/** The page `name` is registered under among a module's `DEMOS_*` exports. */
function demoIn(
  mod: Record<string, unknown>,
  name: string,
): unknown | undefined {
  for (let [exportName, value] of Object.entries(mod)) {
    if (!exportName.startsWith('DEMOS_') || !value) continue;
    let page = (value as Record<string, unknown>)[name];
    if (page) {
      return page;
    }
  }
  return undefined;
}

// the realm loader hands each module its own loader on import.meta
async function importSibling(path: string): Promise<Record<string, unknown>> {
  // @ts-ignore tsc checks realm modules as CommonJS and rejects import.meta
  let meta = import.meta as ImportMeta & { loader: Loader };
  return (await meta.loader.import(new URL(path, meta.url).href)) as Record<
    string,
    unknown
  >;
}

/** Load `subject`'s usage page; undefined when it has none or its module fails to load. */
export async function loadDemo(
  subject: DemoSubject,
): Promise<unknown | undefined> {
  let path = demoModuleFor(subject);
  if (!path) {
    return undefined;
  }
  try {
    return demoIn(await importSibling(path), subject.name);
  } catch (e) {
    console.warn(`Pretui: no usage page for ${subject.name} at ${path}`, e);
    return undefined;
  }
}

/** Load the example gallery registered for `name` in ./examples, if any. */
export async function loadExamples(
  name: string,
): Promise<ExampleSpec[] | undefined> {
  let mod = await importSibling('./examples');
  return (mod.EXAMPLES as Record<string, ExampleSpec[]>)[name];
}
