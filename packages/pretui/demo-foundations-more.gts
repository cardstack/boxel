// Pretui — demo-foundations-more: the layout and receipt wrappers the foundation usage pages share.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface LayoutSignature { Blocks: { default: [] } }
export const DemoStack: TemplateOnlyComponent<LayoutSignature> = <template><div class='demo-stack'>{{yield}}</div><style scoped>.demo-stack { display: grid; gap: 9px; }</style></template>;
export const DemoRow: TemplateOnlyComponent<LayoutSignature> = <template><div class='demo-row'>{{yield}}</div><style scoped>.demo-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-6, 19px); }</style></template>;

interface ReceiptSignature { Blocks: { default: [] } }
export const DemoReceipt: TemplateOnlyComponent<ReceiptSignature> = <template><span class='demo-receipt'>{{yield}}</span><style scoped>.demo-receipt { color: var(--muted-foreground); font-family: var(--font-mono); font-size: var(--text-ui-xs); }</style></template>;

