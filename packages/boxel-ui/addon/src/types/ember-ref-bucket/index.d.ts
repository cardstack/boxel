declare module 'ember-ref-bucket/modifiers/create-ref' {
  import { ClassBasedModifier } from 'ember-modifier';

  const createRef: ClassBasedModifier<{
    Args: {
      Named: {
        attributes?: any;
        character?: any;
        children?: any;
        resize?: any;
        subtree?: any;
        tracked?: any;
      };
    };
  }>;

  export default createRef;
}

declare module 'ember-ref-bucket' {
  export declare let ref = (_name, _fn?): PropertyDecorator => {};
  export function nodeFor(_context, _name): HTMLElement {}
}

declare module 'ember-ref-bucket/utils/ref' {
  export function resolveGlobalRef() {}
}
