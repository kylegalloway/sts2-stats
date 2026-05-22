import type { WatchEvent } from './ingestion/watcher.js';

export type BroadcastFn = (event: WatchEvent) => void;

let _broadcast: BroadcastFn = () => {};

export function setBroadcast(fn: BroadcastFn) {
  _broadcast = fn;
}

export function broadcast(event: WatchEvent) {
  _broadcast(event);
}
