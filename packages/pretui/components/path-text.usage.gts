// Pretui — PathText usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { PathText } from './path-text';

// ── PathText ────────────────────────────────────────────────────────────
class PathTextUsage extends Component {
  @tracked text = 'Wuyishan · lot B-1181 · spring pick';
  @tracked shape = 'circle';
  @tracked size = 240;
  @tracked radius = 92;
  @tracked amplitude = 28;
  @tracked offset = 0;
  @tracked repeat = 1;
  @tracked fontSize = 15;
  @tracked tracking = 0.6;
  @tracked travel = false;
  @tracked revolution = 18;
  @tracked direction = 'cw';

  setText = (v: string) => (this.text = v);
  setShape = (v: string) => (this.shape = v);
  setSize = (v: number | null) => (this.size = v ?? 240);
  setRadius = (v: number | null) => (this.radius = v ?? 92);
  setAmplitude = (v: number | null) => (this.amplitude = v ?? 28);
  setOffset = (v: number | null) => (this.offset = v ?? 0);
  setRepeat = (v: number | null) => (this.repeat = v ?? 1);
  setFontSize = (v: number | null) => (this.fontSize = v ?? 15);
  setTracking = (v: number | null) => (this.tracking = v ?? 0.6);
  setTravel = (v: boolean) => (this.travel = v);
  setRevolution = (v: number | null) => (this.revolution = v ?? 18);
  setDirection = (v: string) => (this.direction = v);

  get shapeOptions(): string[] {
    return ['circle', 'arc', 'wave'];
  }
  get directionOptions(): string[] {
    return ['cw', 'ccw'];
  }
  get shapeArg(): 'circle' | 'arc' | 'wave' | 'custom' {
    return this.shape as 'circle' | 'arc' | 'wave' | 'custom';
  }
  get directionArg(): 'cw' | 'ccw' {
    return this.direction as 'cw' | 'ccw';
  }
  /** Law 6 in practice: travel says something is ongoing, and it may never be
   * the only thing saying it. This is the text affordance beside it. */
  get travelNote(): string {
    if (!this.travel) {
      return 'At rest. The ring is a layout capability, not motion.';
    }
    if (this.shape !== 'circle') {
      return 'Travel is ignored on this shape — rotating an arc or a wave rotates the SHAPE, which is a different and wrong picture.';
    }
    return 'Turning: cupping in progress.';
  }

  get usage(): string {
    return (
      '<PathText @text=' + "'" + this.text + "'" +
      " @shape='" + this.shape + "'" +
      ' @radius={{' + this.radius + '}} @repeat={{' + this.repeat + '}}' +
      (this.travel ? ' @travel={{true}}' : '') +
      ' />'
    );
  }

  <template>
    <FreestyleUsage
      @name='PathText'
      @description='Text set along an SVG path, using textPath so the glyphs keep real shaping and the SVG carries the string as its accessible name. At rest this is a LAYOUT capability rather than motion — it lives in the motion territory because that is where the catalog files it. Travel is the borderline case Law 6 legislates for: it reads as something is ongoing, so it defaults off, is honoured only where rotating the group is truthful, and must be paired with a text affordance saying what is ongoing.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-pt-demo'>
          <PathText
            class='pretui-pt-demo-art'
            @text={{this.text}}
            @shape={{this.shapeArg}}
            @size={{this.size}}
            @radius={{this.radius}}
            @amplitude={{this.amplitude}}
            @offset={{this.offset}}
            @repeat={{this.repeat}}
            @fontSize={{this.fontSize}}
            @tracking={{this.tracking}}
            @travel={{this.travel}}
            @revolution={{this.revolution}}
            @direction={{this.directionArg}}
          />
          <p class='pretui-pt-demo-note'>{{this.travelNote}}</p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='text'
          @required={{true}}
          @value={{this.text}}
          @description='The string to set along the path. It becomes the accessible name of the SVG; the glyphs are presentation, so a repeated ring is not read out three times.'
          @onInput={{this.setText}}
        />
        <Args.String
          @name='shape'
          @value={{this.shape}}
          @defaultValue='circle'
          @options={{this.shapeOptions}}
          @description='Which built-in path. custom takes SVG path data through the path argument, validated against an allowlist — an unrecognised d falls back to the circle rather than being written out.'
          @onInput={{this.setShape}}
        />
        <Args.Number
          @name='size'
          @value={{this.size}}
          @defaultValue={{240}}
          @min={{120}}
          @max={{400}}
          @step={{20}}
          @description='The square viewBox edge. The SVG scales to its box; this only sets the coordinate space.'
          @onInput={{this.setSize}}
        />
        <Args.Number
          @name='radius'
          @value={{this.radius}}
          @min={{30}}
          @max={{180}}
          @step={{2}}
          @description='Circle and arc radius. Defaults to 40 percent of size.'
          @onInput={{this.setRadius}}
        />
        <Args.Number
          @name='amplitude'
          @value={{this.amplitude}}
          @min={{0}}
          @max={{80}}
          @step={{2}}
          @description='Wave height. Defaults to 12 percent of size.'
          @onInput={{this.setAmplitude}}
        />
        <Args.Number
          @name='offset'
          @value={{this.offset}}
          @defaultValue={{0}}
          @min={{0}}
          @max={{100}}
          @step={{1}}
          @description='Where along the path the text starts, in percent.'
          @onInput={{this.setOffset}}
        />
        <Args.Number
          @name='repeat'
          @value={{this.repeat}}
          @defaultValue={{1}}
          @min={{1}}
          @max={{6}}
          @step={{1}}
          @description='Repeat the string around the path this many times, joined by the separator.'
          @onInput={{this.setRepeat}}
        />
        <Args.Number
          @name='fontSize'
          @value={{this.fontSize}}
          @min={{6}}
          @max={{40}}
          @step={{1}}
          @description='Glyph size in viewBox units. Defaults to 6 percent of size.'
          @onInput={{this.setFontSize}}
        />
        <Args.Number
          @name='tracking'
          @value={{this.tracking}}
          @min={{-2}}
          @max={{8}}
          @step={{0.2}}
          @description='Extra letter-spacing in viewBox units.'
          @onInput={{this.setTracking}}
        />
        <Args.Bool
          @name='travel'
          @value={{this.travel}}
          @defaultValue={{false}}
          @description='Rotate the ring. Off by default, honoured only on closed shapes, and never the only carrier of the fact it reports.'
          @onInput={{this.setTravel}}
        />
        <Args.Number
          @name='revolution'
          @value={{this.revolution}}
          @defaultValue={{14}}
          @min={{3}}
          @max={{60}}
          @step={{1}}
          @description='Seconds for one full turn.'
          @onInput={{this.setRevolution}}
        />
        <Args.String
          @name='direction'
          @value={{this.direction}}
          @defaultValue='cw'
          @options={{this.directionOptions}}
          @description='Which way it turns.'
          @onInput={{this.setDirection}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-pathtext-fill'
          @type='color'
          @description='The glyph colour, when the fill argument is not used.'
        />
        <Css.Basic
          @name='pretui-pathtext-revolution'
          @type='duration'
          @description='Seconds per turn, if you would rather set it in CSS than pass a number.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-pt-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: center;
      }
      .pretui-pt-demo-art {
        width: 260px;
        max-width: 100%;
      }
      .pretui-pt-demo-note {
        margin: 0;
        max-width: 44ch;
        text-align: center;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_PATH_TEXT: Record<string, unknown> = {
  PathText: PathTextUsage,
};
