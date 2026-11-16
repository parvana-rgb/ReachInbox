import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';

export const ES_INDEX = `${env.BULLMQ_PREFIX}-emails`;
let client: Client | null = null;

export const esEnabled = () => env.ELASTICSEARCH_ENABLED;
export function getEs(): Client {
  if (!client) client = new Client({ node: env.ELASTICSEARCH_URL, requestTimeout: 10_000, maxRetries: 1 });
  return client;
}
/** Tests inject a fake client. */
export const setEsClient = (c: Client | null) => { client = c; };

let indexReady = false;
export async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  const es = getEs();
  const exists = await es.indices.exists({ index: ES_INDEX });
  if (!exists) {
    await es.indices.create({
      index: ES_INDEX,
      settings: { analysis: { normalizer: { lc: { type: 'custom', filter: ['lowercase'] } } } },
      mappings: {
        properties: {
          userId: { type: 'keyword' },
          batchId: { type: 'keyword' },
          status: { type: 'keyword' },
          toEmail: { type: 'text', fields: { keyword: { type: 'keyword', normalizer: 'lc' } } },
          senderEmail: { type: 'keyword', normalizer: 'lc' },
          subject: { type: 'text' },
          body: { type: 'text' },
          lastError: { type: 'text' },
          scheduledAt: { type: 'date' },
          sendAt: { type: 'date' },
          sentAt: { type: 'date' },
          createdAt: { type: 'date' },
        },
      },
    });
  }
  indexReady = true;
}
export const resetIndexReady = () => { indexReady = false; };
