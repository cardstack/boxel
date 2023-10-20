declare module 'ember-resize-modifier/modifiers/did-resize' {
  import { ClassBasedModifier } from 'ember-modifier';

  const didResizeModifier: ClassBasedModifier<{
    Args: {
      Named: {
        handler: any;
        options?: boolean;
      };
    };
  }>;

  export default didResizeModifier;
}
