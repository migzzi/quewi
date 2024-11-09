import { TaskFuture } from "./future";

export interface IQueue<T, R = any> {
  enqueue(task: T): Promise<TaskFuture<R>>;

  drained(): Promise<void>;

  pause(): void;

  resume(): void;

  idle(): boolean;

  isRunning(): boolean;

  state: "running" | "paused";

  on(
    event: "drain" | "blocked" | "unblocked" | "saturated",
    cb: (...args: any[]) => void
  ): void;
}
