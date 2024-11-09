/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
const noop = (...args: any[]) => {};

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

export type QueueOptions<T> = {
  concurrency: number;
  maxQueueSize: number;
  context?: unknown;
  onDrain?: () => void;
  onBlocked?: (t: T) => void;
  onUnblocked?: (t: T, info: { blockingTime: number }) => void;
  onSaturated?: () => void;
};

export class Queue<T, R = any> {
  private queue: {
    task: T;
    fut: TaskFuture<R>;
  }[] = [];
  private blockedToEnqueue: { cb: (...args: any) => void }[] = [];
  private concurrency: number;
  private maxQueueSize: number;
  private activeTasks = 0;
  private _state: "running" | "paused" = "running";
  private worker: (message: T) => Promise<R>;
  private context: unknown;
  private onDrain: () => void = noop;
  private onSaturated: () => void = noop;
  private onBlocked: (t: T) => void = noop;
  private onUnblocked: (t: T, info: { blockingTime: number }) => void = noop;

  public readonly name: string | undefined;

  constructor(
    name: string,
    worker: (message: T) => Promise<R>,
    opts?: QueueOptions<T>
  );

  constructor(worker: (message: T) => Promise<R>, opts?: QueueOptions<T>);

  constructor(
    nameOrWorker: string | ((message: T) => Promise<R>),
    workerOrOpts: ((message: T) => Promise<R>) | QueueOptions<T>,
    opts?: QueueOptions<T> | undefined
  ) {
    if (typeof nameOrWorker === "string") {
      this.name = nameOrWorker;
      this.worker = workerOrOpts as (message: T) => Promise<R>;
    } else {
      this.name = "Worker-" + Math.random().toString(36).substring(7);
      this.worker = nameOrWorker;
      opts = workerOrOpts as QueueOptions<T>;
    }

    this.concurrency = opts?.concurrency || 1;
    this.maxQueueSize = opts?.maxQueueSize ?? 1;
    this.context = opts?.context ?? {};
    this.onBlocked = opts?.onBlocked ?? noop;
    this.onUnblocked = opts?.onUnblocked ?? noop;
    this.onSaturated = opts?.onSaturated ?? noop;
    this.onDrain = opts?.onDrain ?? noop;
    this._state = "running";
  }

  async enqueue(task: T): Promise<TaskFuture<R>> {
    const isQueueFull =
      this.maxQueueSize > 0
        ? this.queue.length >= this.maxQueueSize
        : this.activeTasks > 0;

    if (isQueueFull || this.state === "paused") {
      const t1 = Date.now();
      await new Promise((resolve) => {
        this.onBlocked(task);
        this.blockedToEnqueue.push({
          cb: resolve,
          //   args: [message],
        });
      });
      this.onUnblocked(task, { blockingTime: Date.now() - t1 });
    }

    const fut = new TaskFuture<R>();

    if (this.activeTasks < this.concurrency) {
      this.activeTasks++;
      this.worker
        .call(this.context || {}, task)
        .then((r: R) => {
          this.onTaskDone(fut, r);
        })
        .catch((e: Error) => {
          this.onTaskDone(fut, null, e);
        });

      return fut;
    }

    this.onSaturated();
    this.queue.push({ task, fut });

    return fut;
  }

  async drained(): Promise<void> {
    if (this.idle()) {
      return Promise.resolve();
    }

    const oldOnDrain = this.onDrain;
    const p = new Promise<void>((resolve) => {
      this.onDrain = function () {
        oldOnDrain();
        resolve();
      };
    });

    // To avoid unhandled promise rejection
    p.catch(() => {});

    return p;
  }

  pause(): void {
    this._state = "paused";
  }

  resume(): void {
    this._state = "running";
    this.processQueue();
    this.processBlocked();
  }

  idle(): boolean {
    return this.queue.length === 0 && this.activeTasks === 0;
  }

  get state(): "running" | "paused" {
    return this._state;
  }

  isRunning(): boolean {
    return this._state === "running";
  }

  private onTaskDone(fut: TaskFuture<R>, res: R | null, err?: Error): void {
    this.activeTasks--;

    if (err) {
      fut.rejectPromise(err);
    } else {
      fut.resolvePromise(res!);
    }

    this.processQueue();
    this.processBlocked();

    if (this.idle()) {
      this.onDrain();
    }
  }

  private processBlocked(): boolean {
    if (this.blockedToEnqueue.length === 0) {
      return false;
    }

    const { cb } = this.blockedToEnqueue.shift()!;
    cb();

    return true;
  }

  private processQueue(): boolean {
    if (this.queue.length === 0 || this.activeTasks >= this.concurrency) {
      return false;
    }

    const { task, fut } = this.queue.shift()!;
    this.activeTasks++;
    this.worker
      .call(this.context, task)
      .then((r: R) => {
        this.onTaskDone(fut, r);
      })
      .catch((e: Error) => {
        this.onTaskDone(fut, null, e);
      });

    return true;
  }
}
