/**
 * Vitest setup file for D1 multi-tenancy tests.
 *
 * Runs once per test worker before any test files.  Initialises the
 * real D1 database pool via wrangler's getPlatformProxy so that SQL
 * executes against actual SQLite-backed D1 instances.
 *
 * Sets `globalThis.fetch` to a local D1 interceptor so that Cloudflare
 * REST API calls (create / delete database) are serviced by real local D1
 * operations — no HTTP mocking required.
 */

import { vi, beforeEach, afterEach, afterAll } from "vitest";
import { initD1Pool, createLocalD1Fetch } from "./helpers";
import { resetShardCache } from "../shard-cache";

// ---------------------------------------------------------------------------
// Environment variables via vi.stubEnv
// ---------------------------------------------------------------------------
vi.stubEnv("CLOUDFLARE_D1_API_TOKEN", "test-api-token");
vi.stubEnv("CLOUDFLARE_ACCT_ID", "test-account-id");

// ---------------------------------------------------------------------------
// Initialise D1 pool (stores on globalThis.__d1TestPool)
// ---------------------------------------------------------------------------
const pool = await initD1Pool();

// Keep a reference to the real fetch for restoration
const realFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Shared hooks – reduce duplication across test files
// ---------------------------------------------------------------------------
beforeEach(() => {
    // Default fetch: intercepts Cloudflare API calls → real local D1 operations
    globalThis.fetch = createLocalD1Fetch(pool);
    resetShardCache();
});

afterEach(async () => {
    // Restore real fetch
    globalThis.fetch = realFetch;
    // Clean allocated D1 databases between tests
    await pool.cleanAllocated();
    pool.reset();
});

afterAll(async () => {
    await pool.dispose();
});
