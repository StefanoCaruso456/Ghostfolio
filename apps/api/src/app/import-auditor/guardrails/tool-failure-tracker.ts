/**
 * Tool Failure Tracker — If the same tool returns status=error 2 times, abort.
 *
 * Prevents flaky tool retries from burning tokens and time.
 */

export const MAX_TOOL_FAILURES = 2;

export class ToolFailureTracker {
  private readonly failureCounts = new Map<string, number>();
  private aborted = false;
  private abortReason: string | undefined;

  /**
   * Record a tool error. Returns true if we should abort.
   */
  public recordFailure(toolName: string): boolean {
    const count = (this.failureCounts.get(toolName) ?? 0) + 1;
    this.failureCounts.set(toolName, count);

    if (count >= MAX_TOOL_FAILURES) {
      this.aborted = true;
      this.abortReason = `Tool "${toolName}" failed ${count} times — aborting to prevent further retries`;

      return true;
    }

    return false;
  }

  public isAborted(): boolean {
    return this.aborted;
  }

  public getAbortReason(): string | undefined {
    return this.abortReason;
  }

  public getFailureCounts(): Map<string, number> {
    return new Map(this.failureCounts);
  }
}
