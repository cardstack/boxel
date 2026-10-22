// Pretui — demo-design-tools: freestyle usage pages for the design-tools
import Component from '@glimmer/component';
// foundation (PropertyRow, PanelSection, ScrubInput, TokenInput, Handle)
// plus a composed inspector panel.
//
// The composed page is deliberately NOT a "Property 1 / Property 2"
// placeholder. Every row in it is a real case lifted from a working
// property panel — a Photoshop-style photographic parameter inspector
// built as Boxel FieldDefs — so the page answers "can the kit express
// this?" rather than "does the kit render?". The four hard cases it exists
// to prove are a STEPPED f-stop scale, a PALETTE-CONSTRAINED colour with
// named swatches, a NESTED property group, and an ARRAY-of-values row.
// The literal scales, palettes and keyword lists below are copied from
// that panel and from real saved instances of it.
//
// Knob sets are derived from the component signatures; figui3 ships no
// usage pages, only a playground, so there was nothing upstream to port.
import { tracked } from '@glimmer/tracking';
import { ColorPalette } from './components/color-palette';
import { FreestyleUsage } from './components/freestyle-usage';
import { Panel } from './components/panel';
import { PanelSection } from './components/panel-section';
import { PropertyRow } from './components/property-row';
import { ScrubInput } from './components/scrub-input';
import { Select } from './components/select';
import type { SelectOption } from './components/select';
import { Switch } from './components/switch';
import { TokenInput } from './components/token-input';
import type { ScaleStops } from './internal/design-tools';

// ── Real scales, palettes and vocabularies ───────────────────────────────
// Full and common half stops, as printed on a lens barrel. The gaps are
// deliberately non-uniform — that is the whole reason @steps exists.
export const APERTURES: ScaleStops = [
  { value: 0.95, label: 'f/0.95' },
  { value: 1, label: 'f/1.0' },
  { value: 1.2, label: 'f/1.2' },
  { value: 1.4, label: 'f/1.4' },
  { value: 1.8, label: 'f/1.8' },
  { value: 2, label: 'f/2.0' },
  { value: 2.8, label: 'f/2.8' },
  { value: 4, label: 'f/4' },
  { value: 5.6, label: 'f/5.6' },
  { value: 8, label: 'f/8' },
  { value: 11, label: 'f/11' },
  { value: 16, label: 'f/16' },
  { value: 22, label: 'f/22' },
];

// A doubling scale: uniform in stops, wildly non-uniform in value.
const ISO_SPEEDS: ScaleStops = [
  { value: 100, label: 'ISO 100' },
  { value: 200, label: 'ISO 200' },
  { value: 400, label: 'ISO 400' },
  { value: 800, label: 'ISO 800' },
  { value: 1600, label: 'ISO 1600' },
  { value: 3200, label: 'ISO 3200' },
  { value: 6400, label: 'ISO 6400' },
  { value: 12800, label: 'ISO 12800' },
  { value: 25600, label: 'ISO 25600' },
];

const BACKGROUND_MODES: SelectOption[] = [
  { value: 'Solid Color', label: 'Solid Color' },
  { value: 'Gradient', label: 'Gradient' },
  { value: 'HDRI', label: 'HDRI' },
  { value: 'Skybox', label: 'Skybox' },
  { value: 'Transparent', label: 'Transparent' },
];

const BACKGROUND_COLORS = [
  '#87CEEB',
  '#F0F8FF',
  '#E0FFFF',
  '#B0E0E6',
  '#FFFFFF',
  '#F5F5F5',
  '#000000',
  '#1C1C1C',
  '#2F4F4F',
  '#696969',
  '#A9A9A9',
  '#D3D3D3',
];
const BACKGROUND_COLOR_NAMES = [
  'Sky blue',
  'Alice blue',
  'Light cyan',
  'Powder blue',
  'White',
  'White smoke',
  'Black',
  'Dark gray',
  'Dark slate gray',
  'Dim gray',
  'Gray',
  'Light gray',
];

// The palette-with-names case in its purest form: sixteen browns and
// blondes nobody can tell apart from a hex code.
const HAIR_COLORS = [
  '#000000',
  '#1c1c1c',
  '#2c1810',
  '#3d2817',
  '#4e3620',
  '#6a4e37',
  '#8b6f47',
  '#b5927e',
  '#daa520',
  '#f4c542',
  '#ffd700',
  '#e6e6e6',
  '#c0c0c0',
  '#808080',
  '#ff4500',
  '#dc143c',
];
const HAIR_COLOR_NAMES = [
  'Black',
  'Jet Black',
  'Dark Brown',
  'Brown',
  'Medium Brown',
  'Chestnut',
  'Light Brown',
  'Caramel',
  'Golden',
  'Blonde',
  'Light Blonde',
  'Platinum',
  'Silver',
  'Gray',
  'Auburn',
  'Red',
];

/** The name a palette gives a colour, for the row's hint line. Named
 * swatches are only useful if the NAME is somewhere a reader can reach —
 * a tooltip on hover is not somewhere. */
function paletteName(
  colors: readonly string[],
  names: readonly string[],
  value: string,
): string {
  let index = colors.findIndex(
    (color) => color.toLowerCase() === value.toLowerCase(),
  );
  return index >= 0 ? names[index] : value;
}

// ── Inspector — the real property panel, composed ────────────────────────
// Every row below is a case lifted from a working photographic parameter
// inspector, not a placeholder. The four it exists to prove:
//
//   · Aperture / ISO — a STEPPED scale. Numeric, but the legal values are
//     an ordered list with non-uniform gaps, and 'f/5.6' is the value's
//     name. `@step` cannot describe that; `@steps` addresses it by index.
//   · Background · Hair colour — a PALETTE-CONSTRAINED colour with NAMED
//     swatches. `ColorPalette` from the colour territory drops straight in;
//     the name goes on the row's hint, because a name a reader can only
//     reach by hovering is not a name.
//   · Subject → Person — a NESTED property group, via `PanelSection
//     @depth={{1}}`.
//   · Mood · Textures — an ARRAY-of-values row, via `TokenInput`.
//
// Nothing here is a bespoke row type. Fifteen row shapes out of four
// components is the test a property sheet has to pass; a panel that needs a
// component per property has a modelling problem, not a component shortage.
class InspectorDemo extends Component {
  backgroundModes = BACKGROUND_MODES;
  backgroundColors = BACKGROUND_COLORS;
  backgroundColorNames = BACKGROUND_COLOR_NAMES;
  hairColors = HAIR_COLORS;
  hairColorNames = HAIR_COLOR_NAMES;
  apertures = APERTURES;
  isoSpeeds = ISO_SPEEDS;

  // camera
  @tracked focalLength: number | null = 50;
  @tracked aperture: number | null = 1.4;
  @tracked iso: number | null = 400;
  @tracked exposureEv: number | null = 1.7;

  // scene
  @tracked backgroundMode = 'Gradient';
  @tracked backgroundColor = '#87CEEB';
  @tracked fogEnabled = false;
  @tracked fogDensity: number | null = 0.15;
  @tracked mood: string[] = ['Stylish', 'Boutique', 'Vibrant yet composed'];
  @tracked textures: string[] = [
    'Velvet',
    'Brushed brass metal',
    'Patterned tile',
    'Ribbed glass',
  ];

  // subject → person
  @tracked distance: number | null = 2.4;
  @tracked age: number | null = 27;
  @tracked hairColor = '#2c1810';

  setFocalLength = (v: number | null) => (this.focalLength = v);
  setAperture = (v: number | null) => (this.aperture = v);
  setIso = (v: number | null) => (this.iso = v);
  setExposureEv = (v: number | null) => (this.exposureEv = v);
  resetExposureEv = () => (this.exposureEv = 0);
  setBackgroundMode = (v: string) => (this.backgroundMode = v);
  setBackgroundColor = (v: string) => (this.backgroundColor = v);
  setFogEnabled = (v: boolean) => (this.fogEnabled = v);
  setFogDensity = (v: number | null) => (this.fogDensity = v);
  setMood = (v: string[]) => (this.mood = v);
  setTextures = (v: string[]) => (this.textures = v);
  setDistance = (v: number | null) => (this.distance = v);
  setAge = (v: number | null) => (this.age = v);
  setHairColor = (v: string) => (this.hairColor = v);

  get exposureModified(): boolean {
    return this.exposureEv !== 0;
  }
  get backgroundColorName(): string {
    return paletteName(
      BACKGROUND_COLORS,
      BACKGROUND_COLOR_NAMES,
      this.backgroundColor,
    );
  }
  get hairColorName(): string {
    return paletteName(HAIR_COLORS, HAIR_COLOR_NAMES, this.hairColor);
  }
  get moodSummary(): string {
    return String(this.mood.length + this.textures.length) + ' keywords';
  }

  <template>
    <FreestyleUsage
      @name='Inspector (composed)'
      @description="The territory doing the job it was ported for, checked against a real property panel rather than a placeholder. Panel supplies the @variant='inspector' shell (flush body so section hairlines run edge to edge, pinned header/footer, its own container context); PanelSection groups and now nests via @depth; PropertyRow carries label, hint, mixed, modified and reset; and the control slot takes whatever the property needs — a stepped f-stop ScrubInput, a Select, a named ColorPalette, a Switch, a TokenInput. Fifteen row shapes, four structural components, no bespoke row type. Every row is keyboard-complete: Tab reaches each control, arrows step (whole stops on a scale), Shift/Alt change the rate, Home/End jump to the ends."
      @source='<PanelSection @title="Subject"><PanelSection @title="Person" @depth={{1}}>…'
    >
      <:example>
        <div class='pretui-inspector-demo'>
          <Panel
            @title='Photo Input'
            @eyebrow='Zara Vale · portrait'
            @variant='inspector'
            @scroll={{true}}
          >
            <PanelSection @title='Camera' @summary='50mm · f/1.4'>
              <PropertyRow @label='Focal length' as |controlId|>
                <ScrubInput
                  @controlId={{controlId}}
                  @label='Focal length'
                  @value={{this.focalLength}}
                  @min={{8}}
                  @max={{800}}
                  @unit='mm'
                  @precision={{0}}
                  @onInput={{this.setFocalLength}}
                />
              </PropertyRow>

              {{! THE STEPPED SCALE. Thirteen stops, non-uniform gaps,
                  labels that are the value's real name. }}
              <PropertyRow
                @label='Aperture'
                @hint='Drag, or arrow through the stops — one stop per press, ten with Shift. There is no half-stop to refine to, so Alt slows the hand instead of subdividing.'
                as |controlId hintId|
              >
                <ScrubInput
                  @controlId={{controlId}}
                  @describedBy={{hintId}}
                  @label='Aperture'
                  @value={{this.aperture}}
                  @steps={{this.apertures}}
                  @steppers={{true}}
                  @onChange={{this.setAperture}}
                />
              </PropertyRow>

              <PropertyRow @label='ISO' as |controlId|>
                <ScrubInput
                  @controlId={{controlId}}
                  @label='ISO'
                  @value={{this.iso}}
                  @steps={{this.isoSpeeds}}
                  @steppers={{true}}
                  @onChange={{this.setIso}}
                />
              </PropertyRow>

              <PropertyRow
                @label='Exposure'
                @modified={{this.exposureModified}}
                @onReset={{this.resetExposureEv}}
                as |controlId|
              >
                <ScrubInput
                  @controlId={{controlId}}
                  @label='Exposure compensation'
                  @value={{this.exposureEv}}
                  @min={{-5}}
                  @max={{5}}
                  @step={{0.1}}
                  @precision={{1}}
                  @unit='EV'
                  @onInput={{this.setExposureEv}}
                />
              </PropertyRow>
            </PanelSection>

            <PanelSection @title='Scene' @summary={{this.moodSummary}}>
              <PropertyRow @label='Background' as |controlId|>
                <Select
                  @options={{this.backgroundModes}}
                  @value={{this.backgroundMode}}
                  @controlId={{controlId}}
                  @onValueChange={{this.setBackgroundMode}}
                />
              </PropertyRow>

              {{! THE PALETTE-CONSTRAINED COLOUR. The name is on the hint
                  line, not only in a hover tooltip. }}
              <PropertyRow
                @layout='stack'
                @hint={{this.backgroundColorName}}
              >
                {{! ColorPalette is a role='group' that names ITSELF, not a
                    labelable control — so the row yields its label block
                    rather than emitting a <label for> pointing at an id
                    that would never exist. }}
                <:label>
                  <span class='inspector-group-label'>Colour</span>
                </:label>
                <:default>
                  <ColorPalette
                    @colors={{this.backgroundColors}}
                    @labels={{this.backgroundColorNames}}
                    @value={{this.backgroundColor}}
                    @columns={{12}}
                    @label='Background colour'
                    @onValueChange={{this.setBackgroundColor}}
                  />
                </:default>
              </PropertyRow>

              <PropertyRow @label='Fog' as |controlId|>
                <Switch
                  @checked={{this.fogEnabled}}
                  @controlId={{controlId}}
                  @onCheckedChange={{this.setFogEnabled}}
                />
              </PropertyRow>
              <PropertyRow
                @label='Density'
                @disabled={{unless this.fogEnabled true}}
                as |controlId|
              >
                <ScrubInput
                  @controlId={{controlId}}
                  @label='Fog density'
                  @value={{this.fogDensity}}
                  @min={{0}}
                  @max={{1}}
                  @step={{0.01}}
                  @precision={{2}}
                  @disabled={{unless this.fogEnabled true}}
                  @onInput={{this.setFogDensity}}
                />
              </PropertyRow>

              {{! THE ARRAY-OF-VALUES ROWS. }}
              <PropertyRow @label='Mood' @layout='stack' as |controlId|>
                <TokenInput
                  @controlId={{controlId}}
                  @value={{this.mood}}
                  @placeholder='Add mood keyword…'
                  @onChange={{this.setMood}}
                />
              </PropertyRow>
              <PropertyRow @label='Textures' @layout='stack' as |controlId|>
                <TokenInput
                  @controlId={{controlId}}
                  @value={{this.textures}}
                  @placeholder='Add texture…'
                  @max={{8}}
                  @onChange={{this.setTextures}}
                />
              </PropertyRow>
            </PanelSection>

            {{! THE NESTED GROUP. }}
            <PanelSection @title='Subject' @summary='Person'>
              <PropertyRow @label='Distance' as |controlId|>
                <ScrubInput
                  @controlId={{controlId}}
                  @label='Subject distance'
                  @value={{this.distance}}
                  @min={{0.1}}
                  @step={{0.1}}
                  @precision={{1}}
                  @unit='m'
                  @onInput={{this.setDistance}}
                />
              </PropertyRow>

              <PanelSection @title='Person' @depth={{1}} @level={{4}}>
                <PropertyRow @label='Age' as |controlId|>
                  <ScrubInput
                    @controlId={{controlId}}
                    @label='Age'
                    @value={{this.age}}
                    @min={{0}}
                    @max={{120}}
                    @precision={{0}}
                    @onInput={{this.setAge}}
                  />
                </PropertyRow>
                <PropertyRow @layout='stack' @hint={{this.hairColorName}}>
                  <:label>
                    <span class='inspector-group-label'>Hair</span>
                  </:label>
                  <:default>
                    <ColorPalette
                      @colors={{this.hairColors}}
                      @labels={{this.hairColorNames}}
                      @value={{this.hairColor}}
                      @columns={{8}}
                      @label='Hair colour'
                      @onValueChange={{this.setHairColor}}
                    />
                  </:default>
                </PropertyRow>
              </PanelSection>
            </PanelSection>
          </Panel>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Yield @description='Composition only — no arguments of its own.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-inspector-demo {
        max-width: 300px;
        height: 460px;
        display: grid;
      }
      /* Matches the dress PropertyRow gives its own <label>; the span is
         authored here, so it lives in this component's CSS scope. */
      .inspector-group-label {
        display: block;
        font-weight: 500;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DESIGN_TOOLS: Record<string, unknown> = {
  Inspector: InspectorDemo,
};
