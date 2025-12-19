import type { ColorFieldConfiguration } from './color-utils';

export interface ColorFieldSignature {
  Args: {
    model: string | null;
    set?: (value: string | null) => void;
    canEdit?: boolean;
    configuration?: ColorFieldConfiguration;
  };
}
