// The build probe's entry point (`probe.html`): it renders the probe page and
// nothing else. It reads no configuration and talks to no server.
import '../styles/layers.css';
import { renderComponent } from '@ember/renderer';

import ProbePage from './probe-page.gts';

renderComponent(ProbePage, { into: document.body });

// The build record's canary. This creates a <style> element, which the policy
// refuses, but nothing calls it, so the probe still loads under the policy:
// shipped and never run, which ADR 019 §1.5 allows. Assigning it keeps it in
// the bundle, so the committed record always marks this module, and
// `pnpm lint:build` fails if the record stops seeing what shipped code does
// at run time.
(globalThis as { styleCanary?: () => HTMLStyleElement }).styleCanary = () =>
  document.createElement('style');
