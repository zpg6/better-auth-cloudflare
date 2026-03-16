/**
 * Shared test helpers for D1 multi-tenancy tests.
 *
 * Provides a real D1 database pool via wrangler's `getPlatformProxy` so that
 * SQL statements execute against actual SQLite-backed D1 instances instead of
 * mocks.  Data written during tests can be verified on the filesystem via
 * `node:fs` or directly through D1 bindings.
 *
 * The `createLocalD1Fetch` interceptor replaces `globalThis.fetch` so that
 * Cloudflare REST API calls (create / delete D1 database) are redirected to
 * real local operations — no HTTP mocking required.
 */

import { getPlatformProxy } from "wrangler";
import { vi } from "vitest";
import { faker } from "@faker-js/faker";
import path from "path";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface D1Pool {
    /** Map a databaseId to a real D1 binding from the pool */
    allocate(databaseId: string): any;
    /** Get the D1 binding for a previously allocated databaseId */
    get(databaseId: string): any | undefined;
    /** Get a raw D1 binding by index (0-9) */
    getByIndex(index: number): any;
    /** Reset allocation state between tests */
    reset(): void;
    /** Clean all tables in all allocated D1 databases */
    cleanAllocated(): Promise<void>;
    /** Dispose the underlying miniflare proxy */
    dispose(): Promise<void>;
    /** The persistence directory path */
    persistDir: string;
    /** All D1 bindings keyed by binding name */
    bindings: Record<string, any>;
    /** Number of bindings allocated so far in this test */
    allocationCount(): number;
}

// ---------------------------------------------------------------------------
// Singleton pool
// ---------------------------------------------------------------------------
let poolInstance: D1Pool | null = null;
let proxyInstance: Awaited<ReturnType<typeof getPlatformProxy>> | null = null;

/**
 * Initialises (or returns the existing) D1 database pool.
 * Call this in a `beforeAll` or vitest setup file.
 */
export async function initD1Pool(): Promise<D1Pool> {
    if (poolInstance) return poolInstance;

    const persistDir = process.env.RUNNER_TEMP
        ? path.join(process.env.RUNNER_TEMP, ".wrangler", "test-state")
        : path.join(process.cwd(), ".wrangler", "test-state");

    proxyInstance = await getPlatformProxy({
        configPath: path.join(process.cwd(), "wrangler.test.toml"),
        persist: { path: persistDir },
    });

    // Collect TEST_DB_* bindings
    const bindings: Record<string, any> = {};
    const bindingList: any[] = [];
    for (let i = 0; i < 10; i++) {
        const key = `TEST_DB_${i}`;
        const binding = (proxyInstance.env as any)[key];
        if (binding) {
            bindings[key] = binding;
            bindingList.push(binding);
        }
    }

    let nextIdx = 0;
    const uuidMap = new Map<string, any>();

    poolInstance = {
        persistDir,
        bindings,

        allocate(databaseId: string) {
            if (uuidMap.has(databaseId)) return uuidMap.get(databaseId);
            const binding = bindingList[nextIdx % bindingList.length];
            nextIdx++;
            uuidMap.set(databaseId, binding);
            return binding;
        },

        get(databaseId: string) {
            return uuidMap.get(databaseId);
        },

        getByIndex(index: number) {
            return bindingList[index % bindingList.length];
        },

        allocationCount() {
            return uuidMap.size;
        },

        reset() {
            nextIdx = 0;
            uuidMap.clear();
        },

        async cleanAllocated() {
            for (const binding of uuidMap.values()) {
                try {
                    const tables = await binding
                        .prepare(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"
                        )
                        .all();
                    for (const row of tables.results || []) {
                        await binding.exec(`DROP TABLE IF EXISTS "${row.name}";`);
                    }
                } catch {
                    // Ignore errors during cleanup
                }
            }
        },

        async dispose() {
            if (proxyInstance) {
                await proxyInstance.dispose();
                proxyInstance = null;
            }
            poolInstance = null;
        },
    };

    // Store on globalThis so the vi.mock factory can access it
    (globalThis as any).__d1TestPool = poolInstance;

    return poolInstance;
}

/**
 * Returns the current D1 pool (must have been initialised first).
 */
export function getD1Pool(): D1Pool {
    if (!poolInstance) {
        throw new Error("D1 pool not initialised – call initD1Pool() first");
    }
    return poolInstance;
}

// ---------------------------------------------------------------------------
// Local D1 fetch interceptor
// ---------------------------------------------------------------------------

/**
 * Creates a `fetch` replacement that intercepts Cloudflare D1 REST API calls
 * and redirects them to real local D1 operations.
 *
 * - POST /d1/database  → allocates a D1 binding, executes `SELECT 1` to
 *   materialise the SQLite file, and returns a realistic API response with the
 *   database UUID.
 * - DELETE /d1/database/:id  → drops all user tables from the binding
 *   (simulating database deletion) and returns a success response.
 *
 * Any other fetch call throws so that unintended network access is caught.
 */
export function createLocalD1Fetch(pool: D1Pool): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.toString()
                  : (input as Request).url;

        // ── D1 database creation ──────────────────────────────────────────
        if (url.includes("/d1/database") && !url.match(/\/d1\/database\/[\w-]+/) && init?.method === "POST") {
            const body = JSON.parse(init.body as string);
            const dbId = crypto.randomUUID();

            // Allocate a real D1 binding and ensure its SQLite file exists
            const binding = pool.allocate(dbId);
            await binding.exec("SELECT 1;");

            return new Response(
                JSON.stringify({
                    success: true,
                    result: { uuid: dbId, name: body.name },
                    errors: [],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        // ── D1 database deletion ──────────────────────────────────────────
        if (url.match(/\/d1\/database\/[\w-]+$/) && init?.method === "DELETE") {
            const dbId = url.split("/d1/database/")[1];

            const binding = pool.get(dbId);
            if (binding) {
                try {
                    const tables = await binding
                        .prepare(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"
                        )
                        .all();
                    for (const row of tables.results || []) {
                        await binding.exec(`DROP TABLE IF EXISTS "${(row as any).name}";`);
                    }
                } catch {
                    // Ignore cleanup errors
                }
            }

            return new Response(
                JSON.stringify({ success: true, result: null, errors: [] }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        throw new Error(`Unexpected fetch call: ${init?.method || "GET"} ${url}`);
    }) as typeof fetch;
}

/**
 * Creates a fetch interceptor that returns specific Cloudflare API errors.
 * Used for testing error handling code paths.
 */
export function createErrorD1Fetch(opts: {
    createError?: { code: number; message: string };
    httpError?: { status: number; statusText: string };
    networkError?: string;
    deleteError?: string;
}): typeof fetch {
    return (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof _input === "string"
                ? _input
                : _input instanceof URL
                  ? _input.toString()
                  : (_input as Request).url;

        if (url.includes("/d1/database") && init?.method === "POST") {
            if (opts.networkError) {
                throw new Error(opts.networkError);
            }
            if (opts.httpError) {
                return new Response(opts.httpError.statusText, {
                    status: opts.httpError.status,
                    statusText: opts.httpError.statusText,
                });
            }
            if (opts.createError) {
                return new Response(
                    JSON.stringify({
                        success: false,
                        errors: [opts.createError],
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            }
        }

        if (url.match(/\/d1\/database\/[\w-]+$/) && init?.method === "DELETE") {
            if (opts.deleteError) {
                throw new Error(opts.deleteError);
            }
        }

        throw new Error(`Unexpected fetch call: ${init?.method || "GET"} ${url}`);
    }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Shared adapter factory
// ---------------------------------------------------------------------------
export function makeAdapter(overrides: Record<string, any> = {}) {
    return {
        findOne: vi.fn<any>().mockResolvedValue(null),
        create: vi.fn<any>().mockResolvedValue({ id: faker.string.uuid() }),
        update: vi.fn<any>().mockResolvedValue({}),
        findMany: vi.fn<any>().mockResolvedValue([]),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// D1 data verification helpers
// ---------------------------------------------------------------------------

/**
 * Query a D1 binding directly to verify data written by tests.
 */
export async function queryD1<T = Record<string, any>>(
    binding: any,
    sql: string,
    ...params: any[]
): Promise<T[]> {
    const stmt = binding.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.all();
    return (result.results || []) as T[];
}

/**
 * Check if a table exists in a D1 database.
 */
export async function tableExists(binding: any, tableName: string): Promise<boolean> {
    const rows = await queryD1(
        binding,
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        tableName
    );
    return rows.length > 0;
}

/**
 * List all user tables in a D1 database.
 */
export async function listTables(binding: any): Promise<string[]> {
    const rows = await queryD1<{ name: string }>(
        binding,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'"
    );
    return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Filesystem verification helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the D1 SQLite object directory.
 */
export function getD1SqliteDir(persistDir: string): string {
    return path.join(persistDir, "d1", "miniflare-D1DatabaseObject");
}

/**
 * Lists all .sqlite files in the D1 persistence directory.
 */
export function listD1SqliteFiles(persistDir: string): string[] {
    const dir = getD1SqliteDir(persistDir);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
}

/**
 * Returns the total size in bytes of all .sqlite files in the D1 persistence directory.
 */
export function getD1SqliteTotalSize(persistDir: string): number {
    const dir = getD1SqliteDir(persistDir);
    if (!fs.existsSync(dir)) return 0;
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sqlite"))
        .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
}

/**
 * Asserts that the D1 persistence directory contains SQLite files.
 */
export function assertD1FilesExist(persistDir: string): void {
    const files = listD1SqliteFiles(persistDir);
    if (files.length === 0) {
        throw new Error(`No .sqlite files found in ${getD1SqliteDir(persistDir)}`);
    }
}
