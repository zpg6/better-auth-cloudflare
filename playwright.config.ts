import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    retries: 2,
    reporter: "list",
    use: {
        headless: true,
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
});
