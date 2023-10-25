import { helper } from '@ember/component/helper';

interface Signature {
  Args: {
    Positional: [];
  };
  Return: MenuDivider;
}
export class MenuDivider {
  type: string;
  constructor() {
    this.type = 'divider';
  }
}

export default helper<Signature>(function (): MenuDivider {
  return new MenuDivider();
});
