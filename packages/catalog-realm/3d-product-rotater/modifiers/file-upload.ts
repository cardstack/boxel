import Modifier from 'ember-modifier';

interface FileUploadModifierSignature {
  Element: HTMLInputElement;
  Args: {
    Positional: [(file: File) => void, ((element: HTMLInputElement) => void)?];
    Named: Record<string, never>;
  };
}

export default class FileUploadModifier extends Modifier<FileUploadModifierSignature> {
  modify(
    element: HTMLInputElement,
    [
      onFileSelected,
      registerInput,
    ]: FileUploadModifierSignature['Args']['Positional'],
  ) {
    if (typeof registerInput === 'function') {
      try {
        registerInput(element);
      } catch (error) {
        console.warn('FileUploadModifier: registerInput threw', error);
      }
    }

    if (!onFileSelected) {
      console.warn('FileUploadModifier: onFileSelected callback missing');
      return;
    }

    const handleChange = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        onFileSelected(file);
      }
    };

    element.addEventListener('change', handleChange);

    // Return cleanup function - Ember will call this automatically
    return () => {
      element.removeEventListener('change', handleChange);
    };
  }
}
