require('ts-node').register({ project: 'tsconfig.json' });
const { getModifyPrompt } = require('../helpers.ts');
const fs = require('fs');
const path = require('path');

async function modify(args) {
  let messages = [];
  if (args.vars.messages) {
    messages = args.vars.messages;
  } else {
    const filepath = args.vars.chat_history;
    const fileContent = fs.readFileSync(filepath, 'utf8');
    messages = JSON.parse(fileContent);
    messages = messages.slice(0, -args.vars.cut_from_end);
  }

  console.log(getModifyPrompt(messages, args.vars.aibot_username));
  return getModifyPrompt(messages, args.vars.aibot_username);
}

module.exports = {
  modify,
};
