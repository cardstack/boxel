import { helper } from '@ember/component/helper';

interface Signature {
  Args: {
    Positional: [];
  };
  Return: MenuDivider;
}
export class MenuDivider {
  isDivider = true;
}

export default helper<Signature>(function (): MenuDivider {
  return new MenuDivider();
});
