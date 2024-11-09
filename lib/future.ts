import { noop } from "./utils";

export class TaskFuture<T> {
  private resolve: (value: T) => void = noop;
  private reject: (reason?: unknown) => void = noop;
  private promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  resolvePromise(value: T): void {
    this.resolve(value);
  }

  rejectPromise(reason: unknown): void {
    this.reject(reason);
  }

  getPromise(): Promise<T> {
    return this.promise;
  }
}
