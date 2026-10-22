// Pretui — Typography usage page.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Typography } from './typography';

const SOURCE = `<Typography.Title @level={{2}}>Spring blend</Typography.Title>
<Typography.Paragraph>Roast <Typography.Text @strong={{true}}>lighter</Typography.Text> than last year.</Typography.Paragraph>
<Typography.Blockquote @attribution='A. Roaster'>…</Typography.Blockquote>`;

const TypographyUsage: TemplateOnlyComponent = <template>
  <FreestyleUsage
    @name='Typography'
    @description='The prose atoms React agents type: Title (h1–h6), Text (inline, with strong, mark, strike and italic as real tags), Paragraph, Code, Blockquote (a figure with its attribution as the caption) and Link (with a safe, announced external mode). Each is also exported on its own. Machine values go through Token; a whole block of rendered markdown is Prose.'
    @source={{SOURCE}}
  >
    <:example>
      <div class='ty-demo'>
        <Typography.Title @level={{2}}>Spring blend</Typography.Title>
        <Typography.Paragraph>
          Roast <Typography.Text @strong={{true}}>lighter</Typography.Text> than last year, and pull the
          <Typography.Text @mark={{true}}>Huila</Typography.Text> lot forward. Run
          <Typography.Code>pnpm roast --lot 7</Typography.Code> to print labels, or read the
          <Typography.Link @href='https://example.com/notes' @external={{true}}>cupping notes</Typography.Link>.
        </Typography.Paragraph>
        <Typography.Paragraph @tone='muted' @size='sm'>Price <Typography.Text @strike={{true}}>$18</Typography.Text> $16 per bag.</Typography.Paragraph>
        <Typography.Blockquote @attribution='A. Roaster'>Stop at first crack plus forty seconds.</Typography.Blockquote>
      </div>
    </:example>
    <:api as |Args|>
      <Args.Number @name='Title @level' @defaultValue={{2}} @description='1–6, the document outline.' />
      <Args.String @name='Title @size' @description='display, heading or subheading, when the look must differ from the level.' />
      <Args.String @name='Text / Paragraph @tone' @defaultValue='default' @description='default, muted, success, warning or danger.' />
      <Args.String @name='Text / Paragraph @size' @description='xs, sm, md or lg.' />
      <Args.Bool @name='Text @strong / @mark / @strike / @italic' @description='The semantic tags.' />
      <Args.String @name='Blockquote @attribution / @cite' />
      <Args.String @name='Link @href' @required={{true}} />
      <Args.Bool @name='Link @external' @description='New tab, rel=noopener, announced.' />
      <Args.String @name='Link @variant' @defaultValue='inline' @description='inline or quiet.' />
    </:api>
  </FreestyleUsage>
  <style scoped>
    .ty-demo {
      display: grid;
      gap: var(--space-3, 0.5rem);
      max-inline-size: 36rem;
    }
  </style>
</template>;

export const DEMOS_TYPOGRAPHY: Record<string, unknown> = {
  Typography: TypographyUsage,
};
