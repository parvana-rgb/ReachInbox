// Runs before every test file, before any app module is imported.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://reachinbox:reachinbox@localhost:5432/reachinbox_test?schema=public',
  REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
  REDIS_DB: '1',
  BULLMQ_PREFIX: 'rib-test',
  ELASTICSEARCH_ENABLED: 'false',
  SLACK_CLIENT_ID: 'test-client-id',
  SLACK_CLIENT_SECRET: 'test-secret',
  SLACK_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GOOGLE_CLIENT_ID: 'test-google-id',
  GOOGLE_CLIENT_SECRET: 'test-google-secret',
  EMAIL_BACKOFF_MS: '150',
  EMAIL_MAX_ATTEMPTS: '3',
  SENDER_COUNT: '2',
  WORKER_CONCURRENCY: '5',
});
