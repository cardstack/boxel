// The credential fields' entry point. It mounts the fields only for a form the
// frame knows, framed by a page on one of the app origins the realm server
// lists, and wires the fields' protocol (`src/security/credentials.js`) to the
// page: the messages, the styles the app sends, and the fields' size.
import '../styles/layers.css';
import Application from '@ember/application';
import { renderComponent, renderSettled } from '@ember/renderer';

import {
  CredentialFrame,
  mayStart,
  readConfig,
  readParams,
} from '../security/credentials.js';
import { Changes } from './changes.ts';
import CredentialFields from './credential-fields.gts';
import { applyStyle, customProperties, whenStyled } from './style.ts';

// An application with nothing registered, whose instance is the owner the
// fields render under. Ember's classic components, which boxel-ui's input
// draws its element with, look up the renderer through their owner.
class FrameApplication extends Application {
  Resolver = {
    create: () => ({ resolve: () => undefined }),
  } as unknown as Application['Resolver'];
}

async function frameOwner() {
  let instance = FrameApplication.create({
    autoboot: false,
    rootElement: document.body,
  }).buildInstance();
  await instance.boot();
  return instance;
}

let config = readConfig(document);
let { form, appOrigin } = readParams(window.location.href);

if (
  mayStart({
    form,
    appOrigin,
    appOrigins: config.appOrigins,
    framed: window.parent !== window,
  })
) {
  void start(appOrigin!);
}

async function start(appOrigin: string) {
  let fieldsForm = () =>
    document.getElementById('credential-fields') as HTMLFormElement | null;
  let requested: string[] = [];
  let changes = new Changes();
  let frame = new CredentialFrame({
    form,
    appOrigin,
    matrixURL: config.matrixURL,
    parent: window.parent,
    send: (message: unknown) => window.parent.postMessage(message, appOrigin),
    applyStyle: (message: Parameters<typeof applyStyle>[2]) =>
      applyStyle(document, requested, message),
    measure: () => fieldsForm()?.getBoundingClientRect().height ?? 0,
    requestSubmit: () => fieldsForm()?.requestSubmit(),
    onChange: changes.bump,
    rendered: renderSettled,
  });
  window.addEventListener('message', (event) => frame.receive(event));
  renderComponent(CredentialFields, {
    owner: await frameOwner(),
    into: document.body,
    args: { frame, changes },
  });
  whenStyled(document).then(() => {
    requested = customProperties(document);
    frame.ready(requested);
  });
}
