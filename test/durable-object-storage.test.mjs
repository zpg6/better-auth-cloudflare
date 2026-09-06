import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BetterAuthDurableObject,
    createDurableObjectRateLimitStorage,
    createDurableObjectStorage,
    withCloudflare,
} from "../dist/index.mjs";

class MemoryDurableObjectStorage {
    values = new Map();
    alarm = null;
    transactionTail = Promise.resolve();
    failNextSetAlarm = false;
    failNextDeleteAll = false;
    deleteAllCalls = 0;
    operationLog = [];

    async get(key) {
        return this.values.get(key);
    }

    async put(key, value) {
        this.values.set(key, value);
    }

    async delete(keys) {
        if (!Array.isArray(keys)) return this.values.delete(keys);
        let deleted = 0;
        for (const key of keys) {
            if (this.values.delete(key)) deleted += 1;
        }
        return deleted;
    }

    async deleteAll() {
        this.operationLog.push("deleteAll");
        if (this.failNextDeleteAll) {
            this.failNextDeleteAll = false;
            throw new Error("storage cleanup failed");
        }
        this.values.clear();
        this.alarm = null;
        this.deleteAllCalls += 1;
    }

    async transaction(callback) {
        const previous = this.transactionTail;
        let release;
        this.transactionTail = new Promise(resolve => {
            release = resolve;
        });
        await previous;
        const values = new Map(this.values);
        const alarm = this.alarm;
        try {
            return await callback(this);
        } catch (error) {
            this.values = values;
            this.alarm = alarm;
            throw error;
        } finally {
            release();
        }
    }

    async getAlarm() {
        return this.alarm;
    }

    async setAlarm(time) {
        this.operationLog.push("setAlarm");
        if (this.failNextSetAlarm) {
            this.failNextSetAlarm = false;
            throw new Error("alarm write failed");
        }
        this.alarm = Number(time);
    }

    async deleteAlarm() {
        this.operationLog.push("deleteAlarm");
        this.alarm = null;
    }

    async fireAlarm(object) {
        this.alarm = null;
        await object.alarm();
    }
}

class MemoryDurableObjectNamespace {
    names = [];
    instances = new Map();

    idFromName(name) {
        return {
            name,
            toString: () => name,
            equals: other => other.toString() === name,
        };
    }

    get(id) {
        const name = id.toString();
        this.names.push(name);
        if (!this.instances.has(name)) {
            const storage = new MemoryDurableObjectStorage();
            const state = { storage };
            this.instances.set(name, {
                object: new BetterAuthDurableObject(state),
                storage,
            });
        }
        const instance = this.instances.get(name);
        return {
            fetch: (input, init) => instance.object.fetch(new Request(input, init)),
        };
    }
}

describe("Durable Object storage", () => {
    it("implements the full Better Auth secondary-storage contract atomically", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace);

        await storage.set("session", "value", 60);
        assert.equal(await storage.get("session"), "value");

        const consumed = await Promise.all(Array.from({ length: 50 }, () => storage.getAndDelete("session")));
        assert.equal(consumed.filter(value => value === "value").length, 1);
        assert.equal(consumed.filter(value => value === null).length, 49);
        assert.equal(
            [...namespace.instances.values()].reduce((sum, instance) => sum + instance.storage.deleteAllCalls, 0),
            1
        );

        const increments = await Promise.all(Array.from({ length: 50 }, () => storage.increment("counter", 60)));
        assert.deepEqual(
            increments.toSorted((left, right) => left - right),
            Array.from({ length: 50 }, (_, index) => index + 1)
        );
        assert.equal(await storage.get("counter"), 50);
        assert.equal(await storage.getAndDelete("counter"), 50);
        assert.equal(await storage.get("counter"), null);
    });

    it("keeps the secondary-storage counter on a fixed window", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const storage = createDurableObjectStorage(new MemoryDurableObjectNamespace());
            assert.equal(await storage.increment("counter", 10), 1);
            now += 9_000;
            assert.equal(await storage.increment("counter", 10), 2);
            now += 1_001;
            assert.equal(await storage.increment("counter", 10), 1);
        } finally {
            Date.now = originalNow;
        }
    });

    it("keeps custom rate limiting on Better Auth's rolling window", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const storage = createDurableObjectRateLimitStorage(new MemoryDurableObjectNamespace());
            assert.deepEqual(await storage.consume("sign-in:ip", { window: 10, max: 2 }), {
                allowed: true,
                retryAfter: null,
            });
            now += 9_000;
            assert.deepEqual(await storage.consume("sign-in:ip", { window: 10, max: 2 }), {
                allowed: true,
                retryAfter: null,
            });
            now += 1_001;
            assert.deepEqual(await storage.consume("sign-in:ip", { window: 10, max: 2 }), {
                allowed: false,
                retryAfter: 9,
            });
            now += 9_000;
            assert.deepEqual(await storage.consume("sign-in:ip", { window: 10, max: 2 }), {
                allowed: true,
                retryAfter: null,
            });
        } finally {
            Date.now = originalNow;
        }
    });

    it("enforces a custom rate limit under concurrency", async () => {
        const storage = createDurableObjectRateLimitStorage(new MemoryDurableObjectNamespace());
        const results = await Promise.all(
            Array.from({ length: 10 }, () => storage.consume("sign-in:ip", { window: 60, max: 3 }))
        );

        assert.equal(results.filter(result => result.allowed).length, 3);
        assert.equal(results.filter(result => !result.allowed).length, 7);
        assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfter === 60));
    });

    it("maps each key to its own stable, opaque object name", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace, { idPrefix: "auth" });

        await storage.set("same-key", "one");
        await storage.get("same-key");
        await storage.set("café/用户", "two");
        const rateLimit = createDurableObjectRateLimitStorage(namespace, { idPrefix: "auth" });
        await rateLimit.consume("same-key", { window: 10, max: 1 });

        assert.equal(
            namespace.names[0],
            "auth:secondary:b7f06468dced375ec726a327f16fd99199f28485fd5338aa0c882dcdada6f078"
        );
        assert.equal(namespace.names[1], namespace.names[0]);
        assert.equal(
            namespace.names[2],
            "auth:secondary:95fad2f77e65c1f3f9491a53947227c18932f0e8f8bd25dbc42f5872049ed8ca"
        );
        assert.equal(
            namespace.names[3],
            "auth:rate-limit:b7f06468dced375ec726a327f16fd99199f28485fd5338aa0c882dcdada6f078"
        );
        assert.equal(new Set(namespace.names).size, 3);

        const isolatedStorage = createDurableObjectStorage(namespace, { idPrefix: "auth-staging" });
        await isolatedStorage.set("same-key", "three");
        assert.notEqual(namespace.names.at(-1), namespace.names[0]);
    });

    it("cleans expired values and cancels alarms for permanent overwrites", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const namespace = new MemoryDurableObjectNamespace();
            const storage = createDurableObjectStorage(namespace);
            await storage.set("shared", "short", 1);
            const [{ object, storage: objectStorage }] = namespace.instances.values();

            now += 1_001;
            await objectStorage.fireAlarm(object);
            assert.equal(await storage.get("shared"), null);
            assert.equal(objectStorage.alarm, null);
            assert.equal(objectStorage.deleteAllCalls, 1);
            assert.deepEqual(objectStorage.operationLog.slice(-2), ["deleteAlarm", "deleteAll"]);

            await storage.set("shared", "temporary", 1);
            await storage.set("shared", "permanent");
            await object.alarm();
            assert.equal(await storage.get("shared"), "permanent");
            assert.equal(objectStorage.alarm, null);
            assert.equal(objectStorage.deleteAllCalls, 1);
        } finally {
            Date.now = originalNow;
        }
    });

    it("treats a zero TTL as delete, matching Better Auth's clamped session TTLs", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace);

        await storage.set("session", "value", 60);
        await storage.set("session", "value", 0);
        const [{ storage: objectStorage }] = namespace.instances.values();
        assert.equal(await storage.get("session"), null);
        assert.equal(objectStorage.alarm, null);
        assert.equal(objectStorage.deleteAllCalls, 1);
    });

    it("returns null from getAndDelete for an expired value and cleans up", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const namespace = new MemoryDurableObjectNamespace();
            const storage = createDurableObjectStorage(namespace);
            await storage.set("code", "value", 1);
            const [{ storage: objectStorage }] = namespace.instances.values();

            now += 1_000;
            assert.equal(await storage.getAndDelete("code"), null);
            assert.equal(objectStorage.deleteAllCalls, 1);
        } finally {
            Date.now = originalNow;
        }
    });

    it("resets a custom rate limit exactly at the window boundary", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const storage = createDurableObjectRateLimitStorage(new MemoryDurableObjectNamespace());
            await storage.consume("ip", { window: 10, max: 1 });
            now += 9_999;
            assert.equal((await storage.consume("ip", { window: 10, max: 1 })).allowed, false);
            now += 1;
            assert.equal((await storage.consume("ip", { window: 10, max: 1 })).allowed, true);
        } finally {
            Date.now = originalNow;
        }
    });

    it("cleans expired storage when a read arrives before the alarm", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const namespace = new MemoryDurableObjectNamespace();
            const storage = createDurableObjectStorage(namespace);
            await storage.set("session", "value", 1);
            const [{ storage: objectStorage }] = namespace.instances.values();

            now += 1_001;
            assert.equal(await storage.get("session"), null);
            assert.equal(objectStorage.alarm, null);
            assert.equal(objectStorage.deleteAllCalls, 1);
        } finally {
            Date.now = originalNow;
        }
    });

    it("rolls back data when alarm scheduling fails", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace);
        const key = "rollback";

        assert.equal(await storage.get(key), null);
        const [{ storage: objectStorage }] = namespace.instances.values();
        objectStorage.failNextSetAlarm = true;
        await assert.rejects(storage.set(key, "value", 60), /alarm write failed/);
        assert.equal(await storage.get(key), null);
    });

    it("removes a pending alarm when the key is deleted", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace);

        await storage.set("session", "value", 60);
        const [{ storage: objectStorage }] = namespace.instances.values();
        assert.notEqual(objectStorage.alarm, null);

        await storage.delete("session");
        assert.equal(objectStorage.alarm, null);
        assert.equal(objectStorage.deleteAllCalls, 1);
    });

    it("reschedules cleanup after the final automatic alarm retry", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const namespace = new MemoryDurableObjectNamespace();
            const storage = createDurableObjectStorage(namespace);
            await storage.set("session", "value", 1);
            const [{ object, storage: objectStorage }] = namespace.instances.values();
            now += 1_001;
            objectStorage.failNextDeleteAll = true;

            await object.alarm({ isRetry: true, retryCount: 5, scheduledTime: now });
            assert.equal(objectStorage.alarm, now + 60_000);

            now += 60_001;
            await objectStorage.fireAlarm(object);
            assert.equal(objectStorage.alarm, null);
            assert.equal(objectStorage.deleteAllCalls, 1);
        } finally {
            Date.now = originalNow;
        }
    });

    it("reschedules cleanup when deleteAll fails after deleting the alarm", async () => {
        const originalNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const namespace = new MemoryDurableObjectNamespace();
            const storage = createDurableObjectStorage(namespace);
            await storage.set("session", "value", 1);
            const [{ object, storage: objectStorage }] = namespace.instances.values();
            now += 1_001;
            objectStorage.failNextDeleteAll = true;

            await assert.rejects(object.alarm(), /storage cleanup failed/);
            assert.equal(objectStorage.alarm, now + 60_000);
            assert.deepEqual(objectStorage.operationLog.slice(-3), ["deleteAlarm", "deleteAll", "setAlarm"]);

            now += 60_001;
            await objectStorage.fireAlarm(object);
            assert.equal(objectStorage.alarm, null);
            assert.equal(objectStorage.deleteAllCalls, 1);
            assert.deepEqual(objectStorage.operationLog.slice(-2), ["deleteAlarm", "deleteAll"]);
        } finally {
            Date.now = originalNow;
        }
    });

    it("rejects malformed requests and unsafe values", async () => {
        const namespace = new MemoryDurableObjectNamespace();
        const storage = createDurableObjectStorage(namespace);

        assert.throws(() => createDurableObjectStorage(namespace, { idPrefix: "" }), /cannot be empty/);
        await assert.rejects(storage.get(""), /cannot be empty/);
        await assert.rejects(storage.get("x".repeat(2049)), /exceeds 2048 bytes/);
        await assert.rejects(storage.get("\ud800"), /unpaired surrogate/);
        await assert.rejects(storage.increment("counter", 0), /greater than zero/);
        await storage.set("not-a-counter", "one");
        await assert.rejects(storage.increment("not-a-counter", 60), /non-numeric value/);
        await assert.rejects(storage.set("large", "x".repeat(120 * 1024 + 1)), /exceeds 122880 bytes/);

        const object = new BetterAuthDurableObject({ storage: new MemoryDurableObjectStorage() });
        const malformed = await object.fetch(new Request("https://storage/set", { method: "POST", body: "{" }));
        assert.equal(malformed.status, 400);
        const nullBody = await object.fetch(
            new Request("https://storage/set", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "null",
            })
        );
        assert.equal(nullBody.status, 400);
        const badRule = await object.fetch(
            new Request("https://storage/consume", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ rule: { window: 10, max: 0 } }),
            })
        );
        assert.equal(badRule.status, 400);
    });

    it("satisfies Better Auth 1.7 validation without database routing", () => {
        const secondaryStorage = createDurableObjectStorage(new MemoryDurableObjectNamespace());
        const options = withCloudflare(
            { autoDetectIpAddress: false, geolocationTracking: false },
            { secondaryStorage }
        );

        assert.doesNotThrow(() => options.plugins[0].init({ version: "1.7.2", options }));
    });

    it("supports KV sessions with database verification and Durable Object rate limiting", () => {
        const customStorage = createDurableObjectRateLimitStorage(new MemoryDurableObjectNamespace());
        const kv = {
            async get() {
                return null;
            },
            async put() {},
            async delete() {},
        };
        const options = withCloudflare(
            { autoDetectIpAddress: false, geolocationTracking: false, kv },
            {
                database: {},
                verification: { storeInDatabase: true },
                rateLimit: { customStorage },
            }
        );

        assert.doesNotThrow(() => options.plugins[0].init({ version: "1.7.2", options }));
    });
});
