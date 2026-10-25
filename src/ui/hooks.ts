import { useSyncExternalStore } from 'react';
import { controller } from './controller';

/** Re-render on any controller/graph change. Returns the controller for convenience. */
export function useController() {
  useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.snapshotVersion(),
    () => controller.snapshotVersion(),
  );
  return controller;
}
