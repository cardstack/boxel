import { CardDef, field, contains, linksToMany } from './card-api';
import BooleanField from './boolean';
import NumberField from './number';
import StringField from './string';

export class ModelConfiguration extends CardDef {
  static displayName = 'Model Configuration';

  @field modelId = contains(StringField, {
    description: 'The openrouter identifier for the LLM model',
  });

  @field temperature = contains(NumberField, {
    description: 'Temperature setting for model output randomness',
  });

  @field toolsSupported = contains(BooleanField, {
    description: 'Whether this model configuration supports tool usage',
  });
}

export class SystemCard extends CardDef {
  static displayName = 'System Card';

  @field modelConfigurations = linksToMany(ModelConfiguration, {
    description: 'List of available model configurations for this system',
  });
}
