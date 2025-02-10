import EntityDisplayWithIcon from '../components/entity-icon-display';

import { Component } from 'https://cardstack.com/base/card-api';
import BuildingIcon from '@cardstack/boxel-icons/building';

import type { Company } from './shared';

export class ViewCompanyTemplate extends Component<typeof Company> {
  <template>
    <div class='company-group'>
      <EntityDisplayWithIcon @title={{@model.name}} @underline={{true}}>
        <:icon>
          <BuildingIcon />
        </:icon>
      </EntityDisplayWithIcon>
    </div>
  </template>
}
