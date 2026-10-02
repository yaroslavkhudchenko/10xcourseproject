// The run's teardown (test-plan Phase 1): it switches back on the shops this run stopped, first, so that a failed check
// below never leaves them stopped, and only those, never another run's. Then it proves the run asked no shop.
import { expect, test as teardown } from "@playwright/test";
import { requestLogMark, restoreShops } from "../../scripts/e2e-local-db.mjs";
import { readRun, runId } from "./support/run";

teardown("switch this run's shops back on, and prove the run asked no shop", () => {
  const run = runId();
  const restored = restoreShops(run);
  const state = readRun();
  expect(state.run, "the setup project didn't finish, so this run holds no shops").toBe(run);
  // Fewer would mean someone switched this run's shops back on while it ran, so its pages could have asked them.
  expect([...restored].sort(), "this run switched back on exactly the shops its setup stopped").toEqual(
    [...state.stopped].sort(),
  );
  expect(requestLogMark(), "the shop request log moved: a shop request was reserved during the run").toBe(state.mark);
});
