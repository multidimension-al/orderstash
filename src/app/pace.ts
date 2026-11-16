import {BudgetCooldown, Settings, SiteBlocked, WorkPaused} from './model';

export interface PaceState {
  nextAt: number;
  cooldownUntil: number;
  cooldownReason?: 'budget' | 'blocked';
}
export interface PaceIO {
  random?(): number;
  now(): number;
  sleep(ms: number): Promise<void>;
  read(): Promise<PaceState>;
  write(state: PaceState): Promise<void>;
}

export class RequestPacer {
  count = 0;
  paused = false;

  constructor(
    readonly settings: Pick<Settings, 'pace' | 'navigationLimit'>,
    readonly io: PaceIO,
    readonly waiting: (until: number) => void = () => undefined,
  ) {}

  check(): void {
    if (this.paused) {
      throw new WorkPaused('Paused. Your progress has been saved.');
    }
  }

  async beforeVisit(): Promise<void> {
    this.check();
    const state = await this.io.read();

    if (state.cooldownUntil > this.io.now()) {
      if (state.cooldownReason === 'budget') throw new BudgetCooldown(state.cooldownUntil);
      throw new WorkPaused(
        'Amazon access is cooling down until ' +
          new Date(state.cooldownUntil).toLocaleTimeString() +
          '. Try again later.',
      );
    }

    if (this.count >= this.settings.navigationLimit) {
      const resumeAt = this.io.now() + 5 * 60000;
      await this.io.write({...state, cooldownUntil: resumeAt, cooldownReason: 'budget'});
      throw new BudgetCooldown(resumeAt);
    }

    this.waiting(state.nextAt);

    while (state.nextAt > this.io.now()) {
      this.check();
      await this.io.sleep(Math.min(250, state.nextAt - this.io.now()));
    }

    this.check();
    this.count++;
    await this.io.write({
      ...state,
      nextAt:
        this.io.now() +
        Math.max(5000, this.settings.pace) +
        Math.floor(
          (this.io.random?.() ?? Math.random()) *
            Math.max(5000, this.settings.pace) *
            0.5,
        ),
      cooldownUntil:
        this.count >= this.settings.navigationLimit
          ? Math.max(state.cooldownUntil, this.io.now() + 5 * 60000)
          : state.cooldownUntil,
      cooldownReason: this.count >= this.settings.navigationLimit ? 'budget' : state.cooldownReason,
    });
  }

  async block(error: SiteBlocked): Promise<never> {
    const state = await this.io.read();
    await this.io.write({
      ...state,
      cooldownUntil: Math.max(
        state.cooldownUntil,
        this.io.now() + error.cooldownMs,
      ),
      cooldownReason: 'blocked',
    });
    throw error;
  }
}

export function retryAfterMs(value: string | undefined, now: number): number {
  if (!value) {
    return 30 * 60000;
  }

  const seconds = Number(value);
  const duration = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  return Math.max(30 * 60000, Number.isFinite(duration) ? duration : 0);
}
