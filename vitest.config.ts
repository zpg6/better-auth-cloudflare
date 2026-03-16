import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/__tests__/**/*.test.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/__tests__/**", "src/**/*.d.ts"],
        },
        testTimeout: 30000,
        hookTimeout: 30000,
    },
    resolve: {
        alias: {
            "@zpg6-test-pkgs/drizzle-orm/d1-http": "@zpg6-test-pkgs/drizzle-orm/d1-http",
            "@zpg6-test-pkgs/drizzle-orm": "@zpg6-test-pkgs/drizzle-orm",
        },
    },
});
