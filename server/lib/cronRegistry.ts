// Central registry of every cron in the system. Wave 1 / S1 replaces
// each `cron.schedule(...)` call site with `register(name, schedule, fn)`
// so the runtime can enforce single-leader execution (via advisory locks)
// and operators can list/inspect what runs when.

import cron from "node-cron";
import { withAdvisoryLock } from "./lock";

export interface CronJob {
  name: string;
  schedule: string;
  fn: () => Promise<unknown>;
}

const registry: CronJob[] = [];

// Schedule a leader-elected cron. The advisory lock is held only while the
// job runs, so other instances can take it on the next tick if the leader
// has died.
export function registerCron(job: CronJob): void {
  registry.push(job);
  cron.schedule(job.schedule, async () => {
    const result = await withAdvisoryLock(`cron:${job.name}`, async () => {
      try {
        await job.fn();
      } catch (err: any) {
        console.error(`[cron:${job.name}] error:`, err?.message);
      }
    });
    if (result === null) {
      // Another instance is running this job — silent skip.
    }
  });
  console.log(`[cron] registered ${job.name} @ "${job.schedule}"`);
}

export function listCronJobs(): Array<Omit<CronJob, "fn">> {
  return registry.map(({ name, schedule }) => ({ name, schedule }));
}
