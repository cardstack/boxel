// The build probe's entry point (`probe.html`): it renders the probe page and
// nothing else. It reads no configuration and talks to no server.
import '../styles/layers.css';
import { renderComponent } from '@ember/renderer';

import ProbePage from './probe-page.gts';

renderComponent(ProbePage, { into: document.body });
