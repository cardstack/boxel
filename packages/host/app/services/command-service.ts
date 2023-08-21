import Service from '@ember/service';

type Command = 'patch';

class CommandHandler {
  handler: any;
  functions: Map<Command, ((arg: any) => void)[]>;
  constructor(handler: any) {
    this.handler = handler;
    this.functions = new Map();
  }

  public get(command: Command) {
    if (!this.functions.has(command)) {
      return [];
    }
    return this.functions.get(command);
  }

  public async handle(command: Command, arg: any) {
    if (!this.functions.has(command)) {
      throw new Error(`No handler registered for command ${command}`);
    }
    const functions = this.functions.get(command)!;
    for (const func of functions) {
      await func(arg);
    }
  }
  public setHandler(command: Command, func: (arg: any) => void) {
    if (!this.functions.has(command)) {
      this.functions.set(command, []);
    }
    this.functions.get(command)!.push(func);
  }
}

export default class CommandService extends Service {
  commandHandlers: Map<any, CommandHandler> = new Map();;

  public registerCommandHandler(
    handler: any,
    command: Command,
    func: (arg: any) => void,
  ) {
    if (!this.commandHandlers.has(handler)) {
      this.commandHandlers.set(handler, new CommandHandler(handler));
    }
    const commandHandler = this.commandHandlers.get(handler)!;
    commandHandler.setHandler(command, func);
  }

  public async runCommand(command: Command, arg: any) {
    for (const handler of this.commandHandlers.values()) {
      await handler.handle(command, arg);
    }
  }

  public unregisterCommandHandler(handler: any) {
    if (this.commandHandlers.has(handler)) {
      this.commandHandlers.delete(handler);
    }
  }
}
