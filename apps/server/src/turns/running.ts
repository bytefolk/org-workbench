/** Tracks abort hooks for in-flight turns, keyed by positionId. */
export class RunningTurnRegistry {
  private readonly aborts = new Map<string, () => void>();

  register(positionId: string, abort: () => void): void {
    this.aborts.set(positionId, abort);
  }

  unregister(positionId: string): void {
    this.aborts.delete(positionId);
  }

  cancel(positionId: string): boolean {
    const abort = this.aborts.get(positionId);
    if (abort === undefined) return false;
    abort();
    return true;
  }
}
