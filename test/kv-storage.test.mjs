import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { cloudflare, createKVStorage, withCloudflare } from "../dist/index.mjs";

function initializeCloudflarePlugin(options, version) {
    return options.plugins[0].init({ version, options });
}

function createAtomicStorage() {
    const values = new Map();

    return {
        async get(key) {
            return values.get(key) ?? null;
        },
        async getAndDelete(key) {
            const value = values.get(key) ?? null;
            values.delete(key);
            return value;
        },
        async increment(key) {
            const value = Number(values.get(key) ?? 0) + 1;
            values.set(key, value);
            return value;
        },
        async set(key, value) {
            values.set(key, value);
        },
        async delete(key) {
            values.delete(key);
        },
    };
}

function createKV() {
    const values = new Map();
    const puts = [];

    return {
        puts,
        async get(key) {
            return values.get(key) ?? null;
        },
        async put(key, value, options) {
            values.set(key, value);
            puts.push({ key, value, options });
        },
        async delete(key) {
            values.delete(key);
        },
    };
}

describe("createKVStorage", () => {
    it("exposes only operations Workers KV can provide", () => {
        const storage = createKVStorage(createKV());

        assert.deepEqual(Object.keys(storage).sort(), ["delete", "get", "set"]);
        assert.equal(storage.getAndDelete, undefined);
        assert.equal(storage.increment, undefined);
    });

    it("clamps TTLs to the Workers KV minimum", async () => {
        const kv = createKV();
        const storage = createKVStorage(kv);
        const originalWarn = console.warn;
        console.warn = () => {};

        try {
            await storage.set("key", "value", 10);
        } finally {
            console.warn = originalWarn;
        }

        assert.deepEqual(kv.puts, [{ key: "key", value: "value", options: { expirationTtl: 60 } }]);
    });
});

describe("withCloudflare storage wiring", () => {
    const cloudflareOptions = {
        autoDetectIpAddress: false,
        geolocationTracking: false,
    };

    it("preserves a database and secondary storage supplied by Better Auth", () => {
        const database = {};
        const secondaryStorage = {
            get() {},
            set() {},
            delete() {},
        };
        const result = withCloudflare(cloudflareOptions, { database, secondaryStorage });

        assert.equal(result.database, database);
        assert.equal(result.secondaryStorage, secondaryStorage);
    });

    it("does not silently add verification or rate-limit options", () => {
        const result = withCloudflare({ ...cloudflareOptions, kv: createKV() }, {});

        assert.equal(result.verification, undefined);
        assert.equal(result.rateLimit, undefined);
        assert.deepEqual(Object.keys(result.secondaryStorage).sort(), ["delete", "get", "set"]);
    });

    it("leaves Better Auth 1.5 and 1.6 KV configurations alone", () => {
        const result = withCloudflare({ ...cloudflareOptions, kv: createKV() }, {});

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.5.6"));
        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.6.30"));
    });

    it("rejects non-atomic storage when Better Auth 1.7 initializes", () => {
        const result = withCloudflare({ ...cloudflareOptions, kv: createKV() }, {});

        assert.throws(
            () => initializeCloudflarePlugin(result, "1.7.3"),
            /verification requires a database.*secondaryStorage\.increment/
        );
        assert.throws(() => initializeCloudflarePlugin(result, "2.0.0-beta.1"), /storage is not atomic/);
        assert.throws(() => initializeCloudflarePlugin(result, "unknown"), /storage is not atomic/);
    });

    it("does not validate when the standalone plugin is used", () => {
        const plugin = cloudflare(cloudflareOptions);

        assert.doesNotThrow(() =>
            plugin.init({ version: "1.7.3", options: { secondaryStorage: createKVStorage(createKV()) } })
        );
    });

    it("accepts database routing for the operations KV cannot provide", () => {
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            { database: {}, verification: { storeInDatabase: true }, rateLimit: { storage: "database" } }
        );

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.3"));
    });

    it("requires a database for database routing", () => {
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            { verification: { storeInDatabase: true }, rateLimit: { storage: "database" } }
        );

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /requires a database/);
    });

    it("accepts memory rate limiting, custom consume storage, and disabled rate limiting", () => {
        for (const rateLimit of [
            { storage: "memory" },
            { customStorage: { async consume() {} } },
            { enabled: false },
        ]) {
            const result = withCloudflare(
                { ...cloudflareOptions, kv: createKV() },
                { database: {}, verification: { storeInDatabase: true }, rateLimit }
            );
            assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.3"), JSON.stringify(rateLimit));
        }
    });

    it("accepts a full atomic secondary storage without database routing", () => {
        const result = withCloudflare(cloudflareOptions, { secondaryStorage: createAtomicStorage() });

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.3"));
    });

    it("rejects a legacy get/set custom rate-limit store on Better Auth 1.7", () => {
        const result = withCloudflare(cloudflareOptions, {
            secondaryStorage: createAtomicStorage(),
            rateLimit: { customStorage: { get() {}, set() {} } },
        });

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /customStorage.*consume/);
    });

    it("rejects consume-only rate-limit storage on Better Auth 1.5", () => {
        const result = withCloudflare(cloudflareOptions, { rateLimit: { customStorage: { consume() {} } } });

        assert.throws(() => initializeCloudflarePlugin(result, "1.5.6"), /needs 1\.6 or later/);
        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.6.30"));
    });

    it("rejects a legacy custom rate-limit store on Better Auth 1.7 even without secondary storage", () => {
        const result = withCloudflare(cloudflareOptions, {
            database: {},
            rateLimit: { customStorage: { get() {}, set() {} } },
        });

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /customStorage.*consume/);
    });

    it("rejects explicit secondary-storage rate limiting on KV", () => {
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            { database: {}, verification: { storeInDatabase: true }, rateLimit: { storage: "secondary-storage" } }
        );

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /secondaryStorage\.increment/);
    });

    it("ignores rate-limit storage when rate limiting is disabled", () => {
        const result = withCloudflare(cloudflareOptions, {
            rateLimit: { enabled: false, customStorage: { consume() {} } },
        });

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.5.6"));
    });

    it("requires a database for verification.storeInDatabase even without secondary storage", () => {
        const result = withCloudflare(cloudflareOptions, { verification: { storeInDatabase: true } });

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /storeInDatabase requires a database/);
    });

    it("requires a database for database rate limiting even without secondary storage", () => {
        const result = withCloudflare(cloudflareOptions, { rateLimit: { storage: "database" } });

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.3"), /"database" requires a database/);
    });

    it("runs the validation through Better Auth context initialization", async () => {
        const routed = betterAuth(
            withCloudflare(
                { ...cloudflareOptions, kv: createKV() },
                {
                    database: memoryAdapter({}),
                    verification: { storeInDatabase: true },
                    rateLimit: { enabled: true, storage: "database" },
                }
            )
        );
        const context = await routed.$context;
        assert.equal(context.rateLimit.storage, "database");

        const bare = betterAuth(withCloudflare({ ...cloudflareOptions, kv: createKV() }, {})).$context;
        const [major, minor] = context.version.split(".").map(Number);
        if (major > 1 || minor >= 7) {
            await assert.rejects(bare, /storage is not atomic/);
        } else {
            await assert.doesNotReject(bare);
        }
    });

    it("rejects ambiguous KV and custom secondary-storage configuration", () => {
        assert.throws(
            () =>
                withCloudflare(
                    { ...cloudflareOptions, kv: createKV() },
                    {
                        secondaryStorage: {
                            get() {},
                            set() {},
                            delete() {},
                        },
                    }
                ),
            /Configure either withCloudflare/
        );
    });
});
