import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

// Render route errors abort the parent transition, so the nested render.error
// route may not receive params or run its model hook. This service preserves
// the serialized error payload so the template can still display it.
interface RenderErrorContext {
  reason: string;
  cardId?: string;
  nonce?: string;
}

export default class RenderErrorStateService extends Service {
  @tracked private _context: RenderErrorContext | undefined;

  setError(context: RenderErrorContext) {
    this._context = context;
  }

  get reason(): string | undefined {
    return this._context?.reason;
  }

  get cardId(): string | undefined {
    return this._context?.cardId;
  }

  get nonce(): string | undefined {
    return this._context?.nonce;
  }

  clear() {
    this._context = undefined;
  }
}

declare module '@ember/service' {
  interface Registry {
    'render-error-state': RenderErrorStateService;
  }
}
