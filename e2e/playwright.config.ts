import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
