import { saveDraft, publish } from "./actions.js";

export function submit(ready: boolean) {
  if (ready) publish();
  else saveDraft();
  const action = ready ? publish : saveDraft;
  action();
}

export const queue = {
  start() {
    [true, false].forEach((value) => submit(value));
  },
};
queue.start();
