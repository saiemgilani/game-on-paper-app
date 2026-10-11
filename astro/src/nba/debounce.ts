/** Call `fn` once, `ms` after the last call; `cancel()` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  return Object.assign(call, { cancel: () => clearTimeout(timer) });
}
