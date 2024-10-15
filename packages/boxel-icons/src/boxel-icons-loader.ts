export default function loadIconComponent(iconName: string) {
  return import(`./icons/${iconName}.js`);
}
