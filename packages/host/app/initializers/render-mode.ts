import type Application from '@ember/application';

type RenderMode = 'serialize' | 'rehydrate';

export function initialize(app: Application): void {
  if (typeof document === 'undefined') {
    return;
  }

  let mode = (globalThis as { __boxelRenderMode?: string })
    .__boxelRenderMode as RenderMode | undefined;

  if (mode !== 'serialize' && mode !== 'rehydrate') {
    return;
  }

  let env = app.lookup('-environment:main') as { _renderMode?: RenderMode };
  env._renderMode = mode;
}

export default {
  name: 'render-mode',
  before: 'experimental-rehydrate',
  initialize,
};
