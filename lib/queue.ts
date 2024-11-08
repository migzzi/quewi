/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
const noop = (...args: any[]) => {};

class TaskFuture<T> {
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

export class Queue<T, R = any> {
  private queue: {
    task: T;
    fut: TaskFuture<R>;
  }[] = [];

  private blockedToEnqueue: { cb: (...args: any) => void }[] = [];
  private concurrency: number;
  private maxQueueSize: number;
  private activeTasks = 0;
  private state: "running" | "paused" = "running";
  private worker: (message: T) => Promise<R>;
  private context: unknown;
  private onDrain: () => void = noop;
  private onSaturated: () => void = noop;
  private onBlocked: (t: T) => void = noop;
  private onUnblocked: (t: T, info: { blockingTime: number }) => void = noop;

  constructor(
    worker: (message: T) => Promise<R>,
    opts?: {
      concurrency: number;
      maxQueueSize: number;
      context?: unknown;
      onBlocked?: (t: T) => void;
      onUnblocked?: (t: T, info: { blockingTime: number }) => void;
      onSaturated?: () => void;
    }
  ) {
    this.worker = worker;
    this.concurrency = opts?.concurrency || 1;
    this.maxQueueSize = opts?.maxQueueSize ?? 1;
    this.context = opts?.context ?? {};
    this.onBlocked = opts?.onBlocked ?? noop;
    this.onUnblocked = opts?.onUnblocked ?? noop;
    this.onSaturated = opts?.onSaturated ?? noop;
    this.state = "running";
  }

  async enqueue(task: T): Promise<TaskFuture<R>> {
    // console.log(
    //   "Enqueueing task",
    //   task,
    //   this.queue.length,
    //   this.maxQueueSize,
    //   this.concurrency,
    //   this.activeTasks
    // );
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
        console.log("___DRAINED___");
        resolve();
      };
    });

    // To avoid unhandled promise rejection
    p.catch(() => {});

    return p;
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "running";
    this.processQueue();
    this.processBlocked();
  }

  idle(): boolean {
    return this.queue.length === 0 && this.activeTasks === 0;
  }

  private onTaskDone(fut: TaskFuture<R>, res: R | null, err?: Error): void {
    this.activeTasks--;

    if (err) {
      fut.rejectPromise(err);
    } else {
      fut.resolvePromise(res!);
    }

    const hasQueued = this.processQueue();
    const hasUnblocked = this.processBlocked();

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

// async function main() {
//   const worker = async (message: number) => {
//     console.log("Processing message", message);
//     console.log("DONE Processing message", message);
//     return message;
//   };

//   const queue = new MemQueue(worker, {
//     concurrency: 5,
//     maxQueueSize: 5,
//     onBlocked: (task: number) => console.log("Max queue size reached", task),
//     onUnblocked: (t, info) =>
//       console.log(`Task ${t} unblocked. Blocked for ${info.blockingTime}ms`),
//   });

//   const results: number[] = [];
//   for (let i = 0; i < 100; i++) {
//     const fut = await queue.enqueue(i);
//     fut.getPromise().then((r) => {
//       console.log("Result", r);
//       results.push(r);
//     });
//   }

//   await queue.drained();

//   console.log("==============");
//   for (let i = 1; i < results.length; i++) {
//     if (results[i] < results[i - 1]) {
//       console.log("!!!! Out of order");
//     }
//   }
// }

// main();
