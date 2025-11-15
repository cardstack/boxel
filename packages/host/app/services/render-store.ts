import StoreService from './store';

export default class RenderStoreService extends StoreService {
  protected override isRenderStore = true;
}

declare module '@ember/service' {
  interface Registry {
    'render-store': RenderStoreService;
  }
}
