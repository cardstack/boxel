import GlimmerComponent from '@glimmer/component';

export const primitive = Symbol('cardstack-primitive');

type FieldTypeFor<T> = T extends { [primitive]: infer F } ? F : T;

export function contains<CardT extends abstract new(...args: any) => any>(card: CardT): FieldTypeFor<CardT> {
  if (primitive in card) {
    return {
      setupField() {
        let bucket = new WeakMap();
        return {
          get() {
            return bucket.get(this);
          },
          set(value: any) {
            bucket.set(this, value);
          }
        }
      }
    } as any;
  } else {
    throw new Error("composite cards not implemented");
  }
}

// our decorators are implemented by Babel, not TypeScript, so they have a
// different signature than Typescript thinks they do.
export const field = function(_target: object, _key: string| symbol, { initializer }: { initializer(): any }) {
  return initializer().setupField();
} as unknown as PropertyDecorator;

type Constructable = abstract new(...args: any) => any;

type SignatureFor<CardT extends Constructable> = { Args: { model: InstanceType<CardT> } }

export class Component<CardT extends Constructable> extends GlimmerComponent<SignatureFor<CardT>> {

}