// Pretui — the field style every BoxelInput-based control shares (Input,
// Textarea and the typed inputs): the wrapper that re-dresses BoxelInput
// through its token channel, so no CSS reaches into boxel-ui markup. A control
// yields its BoxelInput inside, plus any button or glyph of its own; the
// wrapper is their positioned box. @optional draws the kit's 'Optional'
// label above the field.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface FieldDressSignature {
  Args: { optional?: boolean };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const FieldDress: TemplateOnlyComponent<FieldDressSignature> =
  <template>
    <div class='pretui-inputwrap' ...attributes>
      {{#if @optional}}
        <span class='pretui-inputoptional'>Optional</span>
      {{/if}}
      <div class='pretui-inputwrap-field'>{{yield}}</div>
    </div>
    <style scoped>
      @layer PretComponent {
        /* the kit's field style, Select's trigger the reference: the --field
           face, an --input edge, the theme's --ring and --muted-foreground,
           Button's corner, a --boxel-form-control-height-sm height and
           --boxel-font-size-xs type */
        .pretui-inputwrap {
          position: relative;
          width: 100%;
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
          --background: var(--field);
          --border: var(--input);
          --boxel-form-control-height: var(--boxel-form-control-height-sm);
          --boxel-input-height: var(--boxel-form-control-height-sm);
          --boxel-form-control-border-radius: calc(var(--radius) - 0.125rem);
          /* the helper and error rows, a step below the field's text */
          --boxel-font-size-sm: var(--boxel-font-size-2xs);
          --boxel-sp-xs: var(--boxel-sp-3xs);
          /* Select's 0.625rem text inset on both sides, less this edge's 1px
             border. While a validation icon shows, BoxelInput reserves its
             column at the end instead. */
          --boxel-sp-sm: calc(0.625rem - 1px);
          --boxel-input-padding-inline-end: calc(0.625rem - 1px);
          /* Select's and Autocomplete's states. Hover leaves the edge alone
             unless the pointer can hover (below). Focus is the kit's 2px --ring
             outline, laid over the 1px border, which BoxelInput turns --ring. */
          --boxel-input-hover-border-color: var(--border);
          --boxel-input-outline: 0 solid transparent;
          --boxel-input-outline-offset: -1px;
          --boxel-input-invalid-color: var(--destructive-ink);
          --boxel-input-invalid-box-shadow: none;
          --boxel-input-invalid-focus-outline: 2px solid var(--ring);
          --boxel-input-invalid-focus-box-shadow: none;
          --boxel-input-disabled-opacity: var(--boxel-disabled-opacity);
          /* read-only stays focusable and copyable, so it isn't dimmed */
          --boxel-input-readonly-opacity: 1;
          /* the invalid dress, from the control's own validation or an
             invalid Field: the -ink edge, as on Autocomplete (the fill hue
             misses a boundary's 3:1), and no tint */
          --pretui-invalid-border: var(--destructive-ink);
          --pretui-invalid-background: var(--field);
        }
        @media (hover: hover) {
          /* Select's hover edge: toward --foreground, in both schemes. It
             mixes from --border, so an invalid field keeps its error edge on
             hover, darkened. */
          .pretui-inputwrap {
            --boxel-input-hover-border-color: color-mix(
              in oklch,
              var(--foreground) 30%,
              var(--border)
            );
          }
          /* hovering the field or a button inside it (Search's clear,
             Password's reveal), not its message rows. The edge is set one
             level in, so it reads the hover color the wrapper resolved from
             its own --border. */
          .pretui-inputwrap:has(:is(input, textarea, button):hover):not(
              :has(:is(input, textarea):is(:focus, :disabled))
            )
            > .pretui-inputwrap-field {
            --border: var(--boxel-input-hover-border-color);
            --boxel-input-invalid-color: var(--boxel-input-hover-border-color);
          }
        }
        /* forced colors paint a transparent outline, so it only gets a width
           on focus; at rest it would look the same as the focus ring. Focus
           swaps the error edge for the ring, which wins over hover. */
        .pretui-inputwrap:has(:is(input, textarea):focus) {
          --boxel-input-outline: 2px solid transparent;
          --boxel-input-invalid-color: var(--ring);
        }
        .pretui-inputoptional {
          display: block;
          margin-block-end: var(--boxel-sp-3xs);
          font-size: var(--boxel-font-size-2xs);
          font-style: oblique;
          text-align: end;
          opacity: 0.75;
        }
        /* iOS zooms into inputs under 16px on focus */
        @media (pointer: coarse) {
          .pretui-inputwrap {
            font-size: var(--boxel-form-control-touch-font-size);
          }
        }
        /* a disabled field can't be fixed, so it drops the error edge */
        .pretui-inputwrap:has(:is(input, textarea):disabled) {
          --pretui-invalid-border: var(--input);
        }
        /* the control's own validation; Field's rule adds the same edge for a
           Field-level error */
        .pretui-inputwrap:has(:is(input, textarea)[aria-invalid='true']) {
          --border: var(--pretui-invalid-border);
        }
      }
    </style>
  </template>;
