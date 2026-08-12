declare module 'validator/lib/*.js' {
  const validator: (...args: any[]) => any;
  export default validator;
}

declare module 'validator' {
  const validator: Record<string, any>;
  export default validator;
}
