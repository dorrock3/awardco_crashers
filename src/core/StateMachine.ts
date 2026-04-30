/**
 * Generic state machine. States are plain string keys; transitions are looked
 * up in a table. Used by player, enemy, and boss for predictable behavior.
 */
export interface State<Ctx> {
  enter?(ctx: Ctx): void;
  update?(ctx: Ctx, dtMs: number): string | void; // return next state name to transition
  exit?(ctx: Ctx): void;
}

export class StateMachine<Ctx> {
  private current!: string;

  constructor(
    private readonly ctx: Ctx,
    private readonly states: Record<string, State<Ctx>>,
    initial: string
  ) {
    this.current = initial;
    this.states[initial]?.enter?.(this.ctx);
  }

  get state(): string {
    return this.current;
  }

  is(name: string): boolean {
    return this.current === name;
  }

  change(name: string): void {
    if (name === this.current) return;
    if (!this.states[name]) {
      throw new Error(`Unknown state: ${name}`);
    }
    this.states[this.current]?.exit?.(this.ctx);
    this.current = name;
    this.states[this.current]?.enter?.(this.ctx);
  }

  update(dtMs: number): void {
    const next = this.states[this.current]?.update?.(this.ctx, dtMs);
    if (typeof next === 'string') this.change(next);
  }
}
