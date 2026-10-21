// Runs before any test module loads: point the app at a dedicated test
// database and make the test-suite hermetic (no scheduler, in-memory
// cache/queue drivers).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://pulsecheck:pulsecheck@127.0.0.1:5432/pulsecheck_test';
process.env.DISABLE_SCHEDULER = 'true';
process.env.CACHE_DRIVER = 'memory';
process.env.QUEUE_DRIVER = 'memory';
process.env.JWT_SECRET = 'test-secret';
