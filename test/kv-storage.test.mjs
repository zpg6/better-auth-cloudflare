import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { createKVStorage, withCloudflare } from "../dist/index.mjs";

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

    it("resolves request-scoped geolocation when the session hook runs", async () => {
        let cf = { city: "Paris", country: "FR" };
        const result = withCloudflare(
            {
                autoDetectIpAddress: false,
                geolocationTracking: true,
                cf: () => cf,
            },
            {}
        );
        const initialized = initializeCloudflarePlugin(result, "1.7.2");
        const hook = initialized.options.databaseHooks.session.create.before;

        const first = await hook({}, null);
        cf = { city: "Tokyo", country: "JP" };
        const second = await hook({}, null);

        assert.equal(first.data.city, "Paris");
        assert.equal(first.data.country, "FR");
        assert.equal(second.data.city, "Tokyo");
        assert.equal(second.data.country, "JP");
    });

    it("preserves pre-1.7 KV behavior", () => {
        const result = withCloudflare({ ...cloudflareOptions, kv: createKV() }, {});

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.5.6"));
        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.6.30"));
    });

    it("rejects non-atomic storage when Better Auth 1.7 initializes", () => {
        const result = withCloudflare({ ...cloudflareOptions, kv: createKV() }, {});

        assert.throws(
            () => initializeCloudflarePlugin(result, "1.7.2"),
            /verification requires a database.*secondaryStorage\.increment/
        );
        assert.throws(() => initializeCloudflarePlugin(result, "2.0.0-beta.1"), /storage is not atomic/);
        assert.throws(() => initializeCloudflarePlugin(result, "unknown"), /storage is not atomic/);
    });

    it("accepts database routing for the operations KV cannot provide", () => {
        const database = {};
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            {
                database,
                verification: { storeInDatabase: true },
                rateLimit: { storage: "database" },
            }
        );

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.2"));
    });

    it("accepts each atomic operation from a different supported backend", () => {
        const database = {};
        const customStorage = {
            async consume() {
                return { allowed: true, retryAfter: null };
            },
        };
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            {
                database,
                verification: { storeInDatabase: true },
                rateLimit: { customStorage },
            }
        );

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.2"));
    });

    it("accepts a full atomic secondary storage without database routing", () => {
        const result = withCloudflare(cloudflareOptions, { secondaryStorage: createAtomicStorage() });

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.2"));
    });

    it("checks only the atomic methods used by the selected routes", () => {
        const verificationStorage = {
            get() {},
            getAndDelete() {},
            set() {},
            delete() {},
        };
        const verificationResult = withCloudflare(cloudflareOptions, {
            secondaryStorage: verificationStorage,
            rateLimit: { storage: "memory" },
        });
        assert.doesNotThrow(() => initializeCloudflarePlugin(verificationResult, "1.7.2"));

        const rateLimitStorage = {
            get() {},
            increment() {},
            set() {},
            delete() {},
        };
        const rateLimitResult = withCloudflare(cloudflareOptions, {
            database: {},
            secondaryStorage: rateLimitStorage,
            verification: { storeInDatabase: true },
        });
        assert.doesNotThrow(() => initializeCloudflarePlugin(rateLimitResult, "1.7.2"));
    });

    it("rejects a legacy custom rate-limit store on Better Auth 1.7", () => {
        const result = withCloudflare(cloudflareOptions, {
            secondaryStorage: createAtomicStorage(),
            rateLimit: { customStorage: { get() {}, set() {} } },
        });

        assert.throws(() => initializeCloudflarePlugin(result, "1.7.2"), /customStorage.*consume/);
    });

    it("accepts explicitly disabled rate limiting", () => {
        const result = withCloudflare(
            { ...cloudflareOptions, kv: createKV() },
            {
                database: {},
                verification: { storeInDatabase: true },
                rateLimit: { enabled: false },
            }
        );

        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.7.2"));
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

    it("rejects consume-only rate-limit storage on Better Auth 1.5", () => {
        const result = withCloudflare(cloudflareOptions, { rateLimit: { customStorage: { consume() {} } } });

        assert.throws(() => initializeCloudflarePlugin(result, "1.5.6"), /needs 1\.6 or later/);
        assert.doesNotThrow(() => initializeCloudflarePlugin(result, "1.6.30"));
    });

    it("runs version-aware validation through Better Auth context initialization", async () => {
        const baseline = betterAuth(withCloudflare(cloudflareOptions, {}));
        const { version } = await baseline.$context;
        const [major, minor] = version.split(".").map(Number);
        const requiresAtomicStorage = major > 1 || (major === 1 && minor >= 7);
        const auth = betterAuth(withCloudflare({ ...cloudflareOptions, kv: createKV() }, {}));

        if (requiresAtomicStorage) {
            await assert.rejects(auth.$context, /storage is not atomic/);
        } else {
            await assert.doesNotReject(auth.$context);
        }
    });
});
