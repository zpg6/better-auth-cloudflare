import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateJSON, type JSONObject } from "../src/lib/helpers";

const testFile = join(tmpdir(), "test-package.json");

describe("JSON manipulation", () => {
    beforeEach(() => {
        // Create a test package.json
        const testPackage = {
            name: "test-app",
            version: "1.0.0",
            scripts: {
                dev: "wrangler dev",
                build: "wrangler deploy",
            },
            dependencies: {
                "better-auth": "^1.0.0",
            },
        };
        writeFileSync(testFile, JSON.stringify(testPackage, null, 2));
    });

    afterEach(() => {
        if (existsSync(testFile)) {
            unlinkSync(testFile);
        }
    });

    test("updates package name", () => {
        updateJSON(testFile, json => ({
            ...json,
            name: "my-new-app",
        }));

        const updated = JSON.parse(require("fs").readFileSync(testFile, "utf8"));
        expect(updated.name).toBe("my-new-app");
    });

    test("adds new dependencies", () => {
        updateJSON(testFile, json => {
            const deps = json.dependencies as JSONObject;
            return {
                ...json,
                dependencies: {
                    ...deps,
                    postgres: "^3.4.0",
                    "better-auth-cloudflare": "latest",
                },
            };
        });

        const updated = JSON.parse(require("fs").readFileSync(testFile, "utf8"));
        expect(updated.dependencies.postgres).toBe("^3.4.0");
        expect(updated.dependencies["better-auth-cloudflare"]).toBe("latest");
    });

    test("updates scripts with D1 binding name", () => {
        const d1Binding = "MY_DATABASE";
        updateJSON(testFile, json => {
            const scripts = json.scripts as JSONObject;
            return {
                ...json,
                scripts: {
                    ...scripts,
                    "db:migrate:dev": `wrangler d1 migrations apply ${d1Binding} --local`,
                    "db:migrate:prod": `wrangler d1 migrations apply ${d1Binding} --remote`,
                },
            };
        });

        const updated = JSON.parse(require("fs").readFileSync(testFile, "utf8"));
        expect(updated.scripts["db:migrate:dev"]).toBe("wrangler d1 migrations apply MY_DATABASE --local");
        expect(updated.scripts["db:migrate:prod"]).toBe("wrangler d1 migrations apply MY_DATABASE --remote");
    });

    test("preserves existing properties when updating", () => {
        updateJSON(testFile, json => ({
            ...json,
            name: "updated-name",
        }));

        const updated = JSON.parse(require("fs").readFileSync(testFile, "utf8"));
        expect(updated.version).toBe("1.0.0");
        expect(updated.dependencies["better-auth"]).toBe("^1.0.0");
        expect(updated.scripts.dev).toBe("wrangler dev");
    });
});
