import type { AlarmInvocationInfo, DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
const DEFAULT_ID_PREFIX = "better-auth";
const SECONDARY_STORAGE_KEY = "secondary";
const RATE_LIMIT_STORAGE_KEY = "rate-limit";
const CLEANUP_RETRY_MS = 60_000;
const MAX_KEY_BYTES = 2048;
const MAX_VALUE_BYTES = 120 * 1024;

type StoredSecondaryValue = {
    value: string | number;
    expiresAt: number | null;
};

type StoredRateLimit = {
    count: number;
    lastRequest: number;
    expiresAt: number;
};

export type DurableObjectRateLimitRule = {
    window: number;
    max: number;
};

export type DurableObjectRateLimitResult = {
    allowed: boolean;
    retryAfter: number | null;
};

type StorageOperation = "get" | "get-and-delete" | "increment" | "set" | "delete" | "consume";

type StorageRequest = {
    value?: string;
    ttl?: number;
    rule?: DurableObjectRateLimitRule;
};

export interface DurableObjectStorageOptions {
    /**
     * Prefix used to derive Durable Object names. Changing it makes existing
     * values unreachable.
     * @default "better-auth"
     */
    idPrefix?: string;
}

export interface DurableObjectRateLimitStorage {
    consume(key: string, rule: DurableObjectRateLimitRule): Promise<DurableObjectRateLimitResult>;
}

export interface DurableObjectSecondaryStorage {
    get(key: string): Promise<unknown>;
    getAndDelete(key: string): Promise<unknown>;
    increment(key: string, ttl: number): Promise<number>;
    set(key: string, value: string, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
}

export class BetterAuthDurableObject {
    constructor(private readonly state: DurableObjectState) {}

    async fetch(request: Request): Promise<Response> {
        if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405 });
        }

        const operation = parseOperation(new URL(request.url).pathname);
        if (!operation) return new Response("Not Found", { status: 404 });

        let body: StorageRequest;
        try {
            body = parseRequestBody(await request.json());
        } catch (error) {
            return new Response(errorMessage(error, "Invalid storage request"), { status: 400 });
        }

        try {
            switch (operation) {
                case "get":
                    return Response.json({ value: await this.get() });
                case "get-and-delete":
                    return Response.json({ value: await this.getAndDelete() });
                case "increment":
                    return Response.json({ value: await this.increment(requireTtl(body.ttl)) });
                case "set":
                    return Response.json({ value: await this.set(requireValue(body.value), body.ttl) });
                case "delete":
                    return Response.json({ value: await this.delete() });
                case "consume":
                    return Response.json({ value: await this.consume(requireRateLimitRule(body.rule)) });
            }
        } catch (error) {
            if (error instanceof InvalidStorageRequestError) {
                return new Response(error.message, { status: 400 });
            }
            return new Response(errorMessage(error, "Durable Object storage failed"), { status: 500 });
        }
    }

    async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
        try {
            const now = Date.now();
            const empty = await this.state.storage.transaction(async transaction => {
                const secondary = await transaction.get<StoredSecondaryValue>(SECONDARY_STORAGE_KEY);
                const rateLimit = await transaction.get<StoredRateLimit>(RATE_LIMIT_STORAGE_KEY);
                const secondaryExpired = secondary ? isExpired(secondary, now) : false;
                const rateLimitExpired = rateLimit ? rateLimit.expiresAt <= now : false;
                const expired: string[] = [];

                if (secondaryExpired) expired.push(SECONDARY_STORAGE_KEY);
                if (rateLimitExpired) expired.push(RATE_LIMIT_STORAGE_KEY);
                if (expired.length > 0) await transaction.delete(expired);

                const nextExpiration = [
                    secondary && !secondaryExpired && secondary.expiresAt !== null ? secondary.expiresAt : null,
                    rateLimit && !rateLimitExpired ? rateLimit.expiresAt : null,
                ].reduce<number | null>((earliest, expiresAt) => {
                    if (expiresAt === null) return earliest;
                    return earliest === null || expiresAt < earliest ? expiresAt : earliest;
                }, null);
                const hasLiveValues =
                    Boolean(secondary && !secondaryExpired) || Boolean(rateLimit && !rateLimitExpired);

                if (nextExpiration !== null) await transaction.setAlarm(nextExpiration);
                return !hasLiveValues;
            });
            if (empty) await this.clearStorage();
        } catch (error) {
            if ((alarmInfo?.retryCount ?? 0) >= 5) {
                await this.state.storage.setAlarm(Date.now() + CLEANUP_RETRY_MS);
                return;
            }
            throw error;
        }
    }

    private async get(): Promise<string | number | null> {
        const result = await this.state.storage.transaction(async transaction => {
            const entry = await transaction.get<StoredSecondaryValue>(SECONDARY_STORAGE_KEY);
            if (!entry) return { expired: false, value: null };
            if (!isExpired(entry)) return { expired: false, value: entry.value };
            await transaction.delete(SECONDARY_STORAGE_KEY);
            return { expired: true, value: null };
        });
        if (result.expired) await this.cleanupStorageAfterRequest();
        return result.value;
    }

    private async getAndDelete(): Promise<string | number | null> {
        const result = await this.state.storage.transaction(async transaction => {
            const entry = await transaction.get<StoredSecondaryValue>(SECONDARY_STORAGE_KEY);
            if (entry) await transaction.delete(SECONDARY_STORAGE_KEY);
            return {
                hadEntry: entry !== undefined,
                value: entry && !isExpired(entry) ? entry.value : null,
            };
        });
        if (result.hadEntry) await this.cleanupStorageAfterRequest();
        return result.value;
    }

    private async increment(ttl: number): Promise<number> {
        const now = Date.now();
        return this.state.storage.transaction(async transaction => {
            const current = await transaction.get<StoredSecondaryValue>(SECONDARY_STORAGE_KEY);
            const active = current && !isExpired(current, now) ? current : null;
            const previousValue = active?.value;
            if (previousValue !== undefined && typeof previousValue !== "number") {
                throw new Error("Durable Object counter contains a non-numeric value.");
            }
            const value = typeof previousValue === "number" ? safeIncrement(previousValue) : 1;
            const expiresAt = active?.expiresAt ?? expirationFromTtl(ttl, now);
            await transaction.put(SECONDARY_STORAGE_KEY, { value, expiresAt } satisfies StoredSecondaryValue);
            await transaction.setAlarm(expiresAt);
            return value;
        });
    }

    private async set(value: string, ttl?: number): Promise<null> {
        if (ttl !== undefined && ttl <= 0) return this.delete();
        validateValue(value);
        const expiresAt = ttl === undefined ? null : expirationFromTtl(ttl);
        await this.state.storage.transaction(async transaction => {
            await transaction.put(SECONDARY_STORAGE_KEY, { value, expiresAt } satisfies StoredSecondaryValue);
            if (expiresAt === null) await transaction.deleteAlarm();
            else await transaction.setAlarm(expiresAt);
        });
        return null;
    }

    private async delete(): Promise<null> {
        const deleted = await this.state.storage.transaction(transaction => transaction.delete(SECONDARY_STORAGE_KEY));
        if (deleted) await this.cleanupStorageAfterRequest();
        return null;
    }

    private async cleanupStorage(): Promise<void> {
        const empty = await this.state.storage.transaction(async transaction => {
            const [secondary, rateLimit] = await Promise.all([
                transaction.get(SECONDARY_STORAGE_KEY),
                transaction.get(RATE_LIMIT_STORAGE_KEY),
            ]);
            return secondary === undefined && rateLimit === undefined;
        });
        if (empty) await this.clearStorage();
    }

    private async clearStorage(): Promise<void> {
        await this.state.storage.deleteAlarm();
        try {
            await this.state.storage.deleteAll();
        } catch (error) {
            await this.state.storage.setAlarm(Date.now() + CLEANUP_RETRY_MS);
            throw error;
        }
    }

    private async cleanupStorageAfterRequest(): Promise<void> {
        await this.cleanupStorage().catch(() => {});
    }

    private async consume(rule: DurableObjectRateLimitRule): Promise<DurableObjectRateLimitResult> {
        const now = Date.now();
        const windowInMs = durationFromSeconds(rule.window);
        return this.state.storage.transaction(async transaction => {
            const current = await transaction.get<StoredRateLimit>(RATE_LIMIT_STORAGE_KEY);
            const active = current && now - current.lastRequest < windowInMs ? current : null;

            if (active && active.count >= rule.max) {
                const expiresAt = safeExpiration(active.lastRequest, windowInMs);
                if (expiresAt !== active.expiresAt) {
                    await transaction.put(RATE_LIMIT_STORAGE_KEY, { ...active, expiresAt } satisfies StoredRateLimit);
                    await transaction.setAlarm(expiresAt);
                }
                return { allowed: false, retryAfter: Math.ceil((expiresAt - now) / 1000) };
            }

            const count = active ? safeIncrement(active.count) : 1;
            const expiresAt = safeExpiration(now, windowInMs);
            await transaction.put(RATE_LIMIT_STORAGE_KEY, {
                count,
                lastRequest: now,
                expiresAt,
            } satisfies StoredRateLimit);
            await transaction.setAlarm(expiresAt);
            return { allowed: true, retryAfter: null };
        });
    }
}

export function createDurableObjectStorage(
    namespace: DurableObjectNamespace,
    options?: DurableObjectStorageOptions
): DurableObjectSecondaryStorage {
    const client = createStorageClient(namespace, "secondary", options);
    return {
        get: key => client.request<unknown>(key, "get", {}),
        getAndDelete: key => client.request<unknown>(key, "get-and-delete", {}),
        increment: (key, ttl) => client.request<number>(key, "increment", { ttl }),
        set: (key, value, ttl) => client.request<null>(key, "set", { value, ttl }).then(() => undefined),
        delete: key => client.request<null>(key, "delete", {}).then(() => undefined),
    };
}

export function createDurableObjectRateLimitStorage(
    namespace: DurableObjectNamespace,
    options?: DurableObjectStorageOptions
): DurableObjectRateLimitStorage {
    const client = createStorageClient(namespace, "rate-limit", options);
    return {
        consume: (key, rule) => client.request<DurableObjectRateLimitResult>(key, "consume", { rule }),
    };
}

function createStorageClient(
    namespace: DurableObjectNamespace,
    domain: "secondary" | "rate-limit",
    options?: DurableObjectStorageOptions
) {
    const idPrefix = options?.idPrefix ?? DEFAULT_ID_PREFIX;
    validateKey(idPrefix, "idPrefix");

    return {
        async request<T>(key: string, operation: StorageOperation, body: StorageRequest): Promise<T> {
            validateKey(key, "storage key");
            const stub = namespace.get(namespace.idFromName(`${idPrefix}:${domain}:${await sha256(key)}`));
            const response = await stub.fetch(`https://better-auth-storage/${operation}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                throw new Error(`Durable Object storage ${operation} failed: ${await response.text()}`);
            }
            const payload = (await response.json()) as { value: T };
            return payload.value;
        },
    };
}

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function parseOperation(pathname: string): StorageOperation | null {
    const operation = pathname.slice(1);
    switch (operation) {
        case "get":
        case "get-and-delete":
        case "increment":
        case "set":
        case "delete":
        case "consume":
            return operation;
        default:
            return null;
    }
}

function parseRequestBody(value: unknown): StorageRequest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new InvalidStorageRequestError("Storage request body must be an object.");
    }
    return value as StorageRequest;
}

function requireValue(value: string | undefined): string {
    if (typeof value !== "string") throw new InvalidStorageRequestError("Storage value must be a string.");
    return value;
}

function requireTtl(ttl: number | undefined): number {
    if (typeof ttl !== "number") throw new InvalidStorageRequestError("Storage TTL is required.");
    return ttl;
}

function requireRateLimitRule(rule: DurableObjectRateLimitRule | undefined): DurableObjectRateLimitRule {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
        throw new InvalidStorageRequestError("Rate-limit rule is required.");
    }
    durationFromSeconds(rule.window);
    if (!Number.isFinite(rule.max) || rule.max < 1) {
        throw new InvalidStorageRequestError("Rate-limit max must be at least 1.");
    }
    return rule;
}

function validateKey(value: string, name: string): void {
    if (typeof value !== "string" || value.length === 0) {
        throw new InvalidStorageRequestError(`Durable Object ${name} cannot be empty.`);
    }
    if (new TextEncoder().encode(value).byteLength > MAX_KEY_BYTES) {
        throw new InvalidStorageRequestError(`Durable Object ${name} exceeds ${MAX_KEY_BYTES} bytes.`);
    }
    if (containsUnpairedSurrogate(value)) {
        throw new InvalidStorageRequestError(`Durable Object ${name} contains an unpaired surrogate.`);
    }
}

function validateValue(value: string): void {
    if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) {
        throw new InvalidStorageRequestError(`Durable Object storage value exceeds ${MAX_VALUE_BYTES} bytes.`);
    }
}

function isExpired(entry: { expiresAt: number | null }, now = Date.now()): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= now;
}

function expirationFromTtl(ttl: number, now = Date.now()): number {
    return safeExpiration(now, durationFromSeconds(ttl));
}

function durationFromSeconds(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new InvalidStorageRequestError("Durable Object storage TTL must be greater than zero.");
    }
    const duration = Math.ceil(seconds * 1000);
    if (!Number.isSafeInteger(duration)) {
        throw new InvalidStorageRequestError("Durable Object storage TTL is too large.");
    }
    return duration;
}

function safeExpiration(now: number, duration: number): number {
    const expiresAt = now + duration;
    if (!Number.isSafeInteger(expiresAt)) {
        throw new InvalidStorageRequestError("Durable Object storage TTL is too large.");
    }
    return expiresAt;
}

function safeIncrement(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
        throw new Error("Durable Object counter contains an invalid value.");
    }
    return value + 1;
}

function containsUnpairedSurrogate(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
            index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

class InvalidStorageRequestError extends Error {}
