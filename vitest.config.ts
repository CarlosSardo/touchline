import { randomUUID } from "node:crypto";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{server,shared,src}/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 180000,
    env: {
      SQL_TEST_MODE: "true",
      SQL_SCHEMA: `touchline_test_${randomUUID().replaceAll("-", "")}`,
    },
  },
});
