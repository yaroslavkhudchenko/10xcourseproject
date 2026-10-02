// The run's teardown (test-plan Phase 1): it switches back on the shops an e2e run stopped, first, so that a failed check
// below never leaves them stopped, and then proves the run reserved no shop request.
import { expect, test as teardown } from "@playwright/test";
import { requestLogMark, restoreShops } from "../../scripts/e2e-local-db.mjs";
import { readRun } from "./support/run";

teardown("switch the stopped shops back on, and prove the run asked no shop", () => {
  restoreShops();
  const { mark } = readRun();
  expect(requestLogMark(), "the shop request log moved: a shop request was reserved during the run").toBe(mark);
});
