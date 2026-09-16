import type { Command, Plugin } from "obsidian";

export interface ExecutionCommandTitles {
  readonly focusCurrent: string;
  readonly clockOut: string;
  readonly locatePrimary: string;
}

export interface ExecutionCommandDependencies {
  readonly plugin: Plugin;
  readonly titles: () => ExecutionCommandTitles;
  readonly focusCurrent: () => void | Promise<void>;
  readonly clockOut: () => void | Promise<void>;
  readonly locatePrimary: () => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export class ExecutionCommandRegistry {
  readonly #dependencies: ExecutionCommandDependencies;
  readonly #registered: string[] = [];

  constructor(dependencies: ExecutionCommandDependencies) {
    this.#dependencies = dependencies;
  }

  get active(): boolean {
    return this.#registered.length > 0;
  }

  start(): void {
    if (this.active) return;
    const titles = this.#dependencies.titles();
    const commands: readonly Omit<Command, "id">[] = [
      {
        name: titles.focusCurrent,
        icon: "timer",
        callback: () => this.#run(this.#dependencies.focusCurrent),
      },
      {
        name: titles.clockOut,
        icon: "square",
        callback: () => this.#run(this.#dependencies.clockOut),
      },
      {
        name: titles.locatePrimary,
        icon: "locate-fixed",
        callback: () => this.#run(this.#dependencies.locatePrimary),
      },
    ];
    commands.forEach((command, index) => {
      const id = `execution-${index + 1}`;
      this.#dependencies.plugin.addCommand({
        id,
        ...command,
      });
      this.#registered.push(id);
    });
  }

  refresh(): void {
    if (!this.active) return;
    this.stop();
    this.start();
  }

  stop(): void {
    for (const id of this.#registered.splice(0)) {
      this.#dependencies.plugin.removeCommand(id);
    }
  }

  #run(action: () => void | Promise<void>): void {
    void Promise.resolve().then(action).catch(this.#dependencies.onError);
  }
}
