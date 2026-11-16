import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { queueCall } from './wish-import-queue-client.mjs';
const job = JSON.parse(readFileSync(join(process.env.RUNNER_TEMP, 'wish-import-request.json'), 'utf8'));
if (job.id) {
  const updated = await queueCall('finish', { id: job.id, success: process.env.IMPORT_RESULT === 'success' });
  if (!updated) throw new Error('Import lease changed; result was not recorded');
  console.log('Owner import status updated');
}
