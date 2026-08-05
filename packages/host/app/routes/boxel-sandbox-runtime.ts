import Route from '@ember/routing/route';

export interface BoxelSandboxRuntimeModel {
  bootstrapId: string;
  parentOrigin: string;
}

/** Inert child entry point. All authority arrives over one transferred port. */
export default class BoxelSandboxRuntimeRoute extends Route {
  model(): BoxelSandboxRuntimeModel {
    if (window.parent === window) {
      throw new Error('The Boxel Sandbox runtime must run inside an iframe');
    }
    let parameters = new URL(globalThis.location.href).searchParams;
    let bootstrapId = parameters.get('bootstrapId');
    let parentOrigin = parameters.get('parentOrigin');
    if (!bootstrapId || !parentOrigin) {
      throw new Error('The Boxel Sandbox bootstrap is incomplete');
    }
    let parsedParent = new URL(parentOrigin);
    if (parsedParent.origin !== parentOrigin) {
      throw new Error('The Boxel Sandbox parent origin is invalid');
    }
    if (parsedParent.origin === globalThis.location.origin) {
      throw new Error('The Boxel Sandbox requires a distinct parent origin');
    }
    return { bootstrapId, parentOrigin };
  }
}
