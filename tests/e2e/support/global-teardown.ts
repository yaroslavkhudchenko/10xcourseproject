// The run's last safety net (globalTeardown in playwright.config.ts): Playwright runs it after every run, also after
// Ctrl+C, which can skip the teardown project. It switches back on the shops this run still holds, so an interrupted run
// doesn't leave the local stack's shops stopped. The teardown project keeps the check that no shop request was reserved.
// A process killed outright runs nothing; the next run then refuses to start until `restore` (auth.setup.ts).
import { restoreShops } from "../../../scripts/e2e-local-db.mjs";
import { runId } from "./run";

export default function globalTeardown(): void {
  restoreShops(runId());
}
