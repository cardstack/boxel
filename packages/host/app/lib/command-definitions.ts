import type * as SkillModule from 'https://cardstack.com/base/skill';

export function isValidCommandDefinition(
  commandDefinition?: SkillModule.CommandField,
): commandDefinition is SkillModule.CommandField {
  if (!commandDefinition) {
    return false;
  }

  let codeRef = commandDefinition.codeRef;
  if (
    !codeRef ||
    typeof codeRef.module !== 'string' ||
    typeof codeRef.name !== 'string'
  ) {
    return false;
  }

  let module = codeRef.module.trim();
  let name = codeRef.name.trim();
  let functionName = commandDefinition.functionName?.trim();

  return Boolean(module && name && functionName);
}

export function getUniqueValidCommandDefinitions(
  commandDefinitions: SkillModule.CommandField[] = [],
): SkillModule.CommandField[] {
  let seen = new Set<string>();

  return commandDefinitions.filter((command) => {
    if (!isValidCommandDefinition(command)) {
      return false;
    }
    if (seen.has(command.functionName)) {
      return false;
    }
    seen.add(command.functionName);
    return true;
  });
}
