## Summary

- **Replace all D1 mocks with real local D1 databases** via wrangler `getPlatformProxy()` with local SQLite persistence, ensuring tests execute actual SQL against real D1 bindings
- **Remove all Cloudflare API mocking (nock)** — database create/delete operations now use a local D1 pool with fetch interceptors that allocate real D1 bindings and materialize SQLite files on disk
- **Add shared test infrastructure** (`setup.ts`, `helpers.ts`, `wrangler.test.toml`) to eliminate setup/teardown duplication and provide consistent D1 pool management across all test files

## Changes

### New Files
- **`wrangler.test.toml`** — Defines 10 pre-allocated D1 database bindings (`TEST_DB_0`–`TEST_DB_9`) for local test persistence
- **`src/d1-multi-tenancy/__tests__/setup.ts`** — Vitest setup file that initializes the D1 pool, stubs environment variables via `vi.stubEnv()`, and provides shared `beforeEach`/`afterEach` hooks for fetch interceptor management and pool cleanup
- **`src/d1-multi-tenancy/__tests__/helpers.ts`** — Core test utilities including:
  - `D1Pool` — manages pre-allocated D1 bindings from wrangler with `allocate()`, `cleanAllocated()`, `dispose()`
  - `createLocalD1Fetch()` — fetch interceptor that redirects Cloudflare REST API calls to real local D1 operations
  - `createErrorD1Fetch()` — fetch interceptor for simulating specific API error responses
  - `queryD1()`, `tableExists()`, `listTables()` — SQL query helpers
  - `assertD1FilesExist()`, `listD1SqliteFiles()` — filesystem verification utilities

### Modified Files
- **`vitest.config.ts`** — Added `setupFiles`, single-fork pool configuration (`pool: "forks"`, `singleFork: true`)
- **`.github/workflows/test.yml`** — Added `RUNNER_TEMP` environment variable for GitHub Actions temp directory
- **`.gitignore`** — Added `.wrangler` to ignore local persistence files
- **All test files** (`d1-utils.test.ts`, `index.test.ts`, `utils.test.ts`, `shard-cache.test.ts`, `sharding-multi-db.test.ts`, `integration-sharding.test.ts`) — Rewritten to use real D1 bindings instead of mocks

### Removed Dependencies
- **`nock`** — No longer needed; all 34 references removed from test files

## Key Design Decisions

1. **D1 Pool with `getPlatformProxy()`**: Pre-allocates 10 D1 bindings at test startup. The `createLocalD1Fetch` interceptor allocates bindings from this pool when tests call `createD1Database()`, ensuring each test gets a real SQLite-backed D1 instance.

2. **`vi.mock` with async factory**: Redirects `@zpg6-test-pkgs/drizzle-orm/d1-http` imports to `@zpg6-test-pkgs/drizzle-orm/d1` at module resolution time, so production code using the HTTP driver transparently uses real D1 bindings in tests.

3. **Single-fork execution**: Uses `pool: "forks"` with `singleFork: true` to avoid multiple miniflare instances competing for the same SQLite files.

4. **Filesystem verification**: Tests verify SQLite files exist on disk at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`, confirming data persistence beyond just API-level checks.

## Test Plan

- [x] All 184 tests pass locally with `pnpm test`
- [ ] Verify CI passes on GitHub Actions with `RUNNER_TEMP` for wrangler persistence
- [ ] Confirm no regressions in existing functionality
- [ ] Verify `.wrangler` directory is properly gitignored and not committed
