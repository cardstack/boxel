import type * as SkillModule from 'https://cardstack.com/base/skill';

export function isValidCommandDefinition(
  commandDefinition?: SkillModule.ToolField,
): commandDefinition is SkillModule.ToolField {
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

export function getUniqueValidToolDefinitions(
  toolDefinitionFileDefs: SkillModule.ToolField[] = [],
): SkillModule.ToolField[] {
  let seen = new Set<string>();

  return toolDefinitionFileDefs.filter((command) => {
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
