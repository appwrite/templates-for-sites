import { defineConfig } from 'vitest/config'

// The site's tests. The receipts function has its own, run with `npm test` in receipts-function.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // What Appwrite Sites sets on Cloud. Every request goes to the fake Appwrite in test/fake-appwrite.ts.
    env: {
      APPWRITE_SITE_API_ENDPOINT: 'https://fra.cloud.appwrite.io/v1',
      APPWRITE_SITE_PROJECT_ID: 'template-test',
      APPWRITE_SITE_ID: 'outlay',
      OUTLAY_SETUP_TOKEN: 'correct horse battery staple',
    },
  },
})
