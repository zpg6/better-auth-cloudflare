import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

    it("validates the explicit Better Auth 1.7 KV path", () => {
        const database = {};
        const kvOptions = {
            ...cloudflareOptions,
            kv: createKV(),
            kvAtomicCompatibility: true,
        };

        assert.throws(() => withCloudflare(kvOptions, { database }), /verification\.storeInDatabase/);
        assert.throws(
            () =>
                withCloudflare(kvOptions, {
                    database,
                    verification: { storeInDatabase: true },
                }),
            /rateLimit\.storage/
        );

        const result = withCloudflare(kvOptions, {
            database,
            verification: { storeInDatabase: true },
            rateLimit: { storage: "database" },
        });
        assert.equal(result.database, database);
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
