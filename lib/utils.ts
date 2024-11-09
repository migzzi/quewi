export const noop = (..._: any[]) => {};

export function setTimeoutPromise(fn: () => void, ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(function () {
      resolve();
      fn();
    }, ms);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
