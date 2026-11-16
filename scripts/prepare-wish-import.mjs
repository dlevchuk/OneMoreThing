import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { queueCall } from './wish-import-queue-client.mjs';
const fromQueue = process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.PROCESS_QUEUE === 'true';
const job = fromQueue ? await queueCall('claim') : {
  url: process.env.PRODUCT_URL, priority: process.env.PRIORITY || 'unsure', allowUnmonitored: process.env.ALLOW_UNMONITORED === 'true'
};
if (job) {
  if (typeof job.url !== 'string' || !/^https?:\/\//.test(job.url) || job.url.length > 3000 || /[\r\n]/.test(job.url) ||
      !['want', 'nice', 'unsure'].includes(job.priority) || typeof job.allowUnmonitored !== 'boolean') throw new Error('Invalid import request');
  writeFileSync(join(process.env.RUNNER_TEMP, 'wish-import-request.json'), JSON.stringify(job), { mode: 0o600 });
}
appendFileSync(process.env.GITHUB_OUTPUT, `has_request=${Boolean(job)}\nqueued=${Boolean(job?.id)}\n`);
console.log(job ? 'Import request prepared' : 'No queued requests');
