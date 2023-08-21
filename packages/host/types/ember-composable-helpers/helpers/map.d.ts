import Helper from '@ember/component/helper';

export default class <T> extends Helper<{
  Args: {
    Positional: [callback: (a: any) => any, array: unknown[]];
  };
  Return: any[];
}> {}
