/**
 * Tests for the cloudflareD1MultiTenancy plugin (index.ts)
 * Fetch, Drizzle ORM, and Better Auth adapter are mocked.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Drizzle before any imports that use it
// ---------------------------------------------------------------------------
const { mockDrizzleRun, mockDrizzleDb, mockDrizzle } = vi.hoisted(() => {
    const mockDrizzleRun = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockDrizzleDb = { run: mockDrizzleRun };
    const mockDrizzle = vi.fn(() => mockDrizzleDb);
    return { mockDrizzleRun, mockDrizzleDb, mockDrizzle };
});

vi.mock("@zpg6-test-pkgs/drizzle-orm/d1-http", () => ({
    drizzle: mockDrizzle,
}));

vi.mock("@zpg6-test-pkgs/drizzle-orm", () => ({
    sql: Object.assign(
        (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ __sql: true }),
        { raw: vi.fn((str: string) => ({ __sql: true, rawStr: str })) }
    ),
}));

import {
    cloudflareD1MultiTenancy,
    createTenantDatabaseClient,
    TenantDatabaseStatus,
} from "../index";
import { CloudflareD1MultiTenancyError } from "../utils";
import { resetShardCache } from "../shard-cache";

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------
const cloudflareD1Api = { apiToken: "test-token", accountId: "test-account" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAdapter(overrides: Partial<{ findOne: any; create: any; update: any }> = {}) {
    return {
        findOne: vi.fn<any>().mockResolvedValue(null),
        create: vi.fn<any>().mockResolvedValue({ id: "rec-123" }),
        update: vi.fn<any>().mockResolvedValue({}),
        ...overrides,
    };
}

function mockFetchSuccess(uuid = "db-uuid-abc") {
    return vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
            success: true,
            result: { uuid, name: `DB_20240101_${uuid}` },
            errors: [],
        }),
    } as any);
}

function mockFetchDeleteSuccess() {
    return vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, result: null, errors: [] }),
    } as any);
}

// ---------------------------------------------------------------------------
// createTenantDatabaseClient
// ---------------------------------------------------------------------------
describe("createTenantDatabaseClient", () => {
    test("should call drizzle with correct connection parameters", () => {
        const client = createTenantDatabaseClient("acct-123", "db-uuid-456", "my-token");

        expect(mockDrizzle).toHaveBeenCalledWith(
            { accountId: "acct-123", databaseId: "db-uuid-456", token: "my-token" },
            expect.any(Object)
        );
        expect(client).toBe(mockDrizzleDb);
    });

    test("should pass debugLogs option to drizzle", () => {
        mockDrizzle.mockClear();
        createTenantDatabaseClient("acct", "db", "tok", true);

        expect(mockDrizzle).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ logger: true })
        );
    });
});

// ---------------------------------------------------------------------------
// cloudflareD1MultiTenancy plugin shape
// ---------------------------------------------------------------------------
describe("cloudflareD1MultiTenancy plugin shape", () => {
    test("should return a plugin with id 'cloudflare-d1-multi-tenancy'", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" });
        expect(plugin.id).toBe("cloudflare-d1-multi-tenancy");
    });

    test("should include schema in the plugin", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" });
        expect(plugin.schema).toBeDefined();
        expect((plugin.schema as any).tenant).toBeDefined();
    });

    test("should expose databaseHooks for user mode", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;
        expect(plugin.databaseHooks).toBeDefined();
        expect(plugin.databaseHooks.user?.create?.after).toBeInstanceOf(Function);
    });

    test("should not expose databaseHooks for organization mode", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;
        expect(plugin.databaseHooks).toBeUndefined();
    });

    test("should expose hooks.after for organization mode", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;
        expect(plugin.hooks?.after).toBeDefined();
        expect(plugin.hooks.after.length).toBe(2); // create + delete hooks
    });

    test("should expose hooks.after delete hook for user mode", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;
        expect(plugin.hooks?.after).toBeDefined();
        expect(plugin.hooks.after.length).toBe(1); // delete hook only
    });
});

// ---------------------------------------------------------------------------
// createTenantDatabase – called via user databaseHook
// ---------------------------------------------------------------------------
describe("createTenantDatabase (user mode)", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
        mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should create a tenant database for a new user", async () => {
        globalThis.fetch = mockFetchSuccess("new-db-uuid");

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(null), // no existing tenant
            create: vi.fn<any>().mockResolvedValue({ id: "rec-001" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-1", email: "a@b.com" },
            { context: { adapter } }
        );

        expect(adapter.findOne).toHaveBeenCalled();
        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "tenant",
                data: expect.objectContaining({
                    tenantId: "user-1",
                    tenantType: "user",
                    status: TenantDatabaseStatus.CREATING,
                }),
            })
        );
        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    databaseId: "new-db-uuid",
                    status: TenantDatabaseStatus.ACTIVE,
                }),
            })
        );
    });

    test("should skip creation if tenant database already exists and is active", async () => {
        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue({
                id: "rec-001",
                tenantId: "user-1",
                status: TenantDatabaseStatus.ACTIVE,
            }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-1", email: "a@b.com" },
            { context: { adapter } }
        );

        expect(adapter.create).not.toHaveBeenCalled();
    });

    test("should re-create if existing tenant database was previously deleted", async () => {
        globalThis.fetch = mockFetchSuccess("rebuilt-db-uuid");

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue({
                id: "rec-001",
                tenantId: "user-1",
                status: TenantDatabaseStatus.DELETED,
            }),
            create: vi.fn<any>().mockResolvedValue({ id: "rec-002" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-1", email: "a@b.com" },
            { context: { adapter } }
        );

        expect(adapter.create).toHaveBeenCalled();
    });

    test("should call beforeCreate and afterCreate hooks when provided", async () => {
        globalThis.fetch = mockFetchSuccess("hook-db-uuid");

        const beforeCreate = vi.fn<any>().mockResolvedValue(undefined);
        const afterCreate = vi.fn<any>().mockResolvedValue(undefined);

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-hooks" }),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            hooks: { beforeCreate, afterCreate },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-hooks", email: "h@b.com" },
            { context: { adapter } }
        );

        expect(beforeCreate).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "user-hooks", mode: "user" })
        );
        expect(afterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: "user-hooks",
                databaseId: "hook-db-uuid",
                mode: "user",
            })
        );
    });

    test("should initialize tenant database with migrations when provided", async () => {
        globalThis.fetch = mockFetchSuccess("migrated-db-uuid");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-mig" }),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: "CREATE TABLE t (id TEXT);",
                currentVersion: "v1.0.0",
            },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-mig", email: "m@b.com" },
            { context: { adapter } }
        );

        // Drizzle run should have been called for the schema SQL
        expect(mockDrizzleRun).toHaveBeenCalled();
    });

    test("should throw CloudflareD1MultiTenancyError when fetch fails", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network error"));

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: "user-fail", email: "f@b.com" },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should use custom databasePrefix in database name", async () => {
        globalThis.fetch = mockFetchSuccess("prefix-db-uuid");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-prefix" }),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            databasePrefix: "MYAPP",
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-prefix", email: "p@b.com" },
            { context: { adapter } }
        );

        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    databaseName: expect.stringMatching(/^MYAPP_/),
                }),
            })
        );
    });
});

// ---------------------------------------------------------------------------
// deleteTenantDatabase – called via user after-hook
// ---------------------------------------------------------------------------
describe("deleteTenantDatabase (user mode)", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should delete an active tenant database", async () => {
        globalThis.fetch = mockFetchDeleteSuccess();

        const existingTenant = {
            id: "rec-del",
            tenantId: "user-del",
            databaseId: "del-db-uuid",
            databaseName: "DB_20240101_abcdef",
            shardHash: "abcdef12",
            status: TenantDatabaseStatus.ACTIVE,
        };

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(existingTenant),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        // Find the delete hook matcher
        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );
        expect(deleteHook).toBeDefined();

        // Simulate calling the handler with a mock context
        await deleteHook.handler({
            context: {
                adapter,
                returned: { user: { id: "user-del" } },
            },
        });

        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({ status: TenantDatabaseStatus.DELETED }),
            })
        );
    });

    test("should skip deletion if no existing active tenant found", async () => {
        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(null),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );

        await deleteHook.handler({
            context: {
                adapter,
                returned: { user: { id: "user-missing" } },
            },
        });

        expect(adapter.update).not.toHaveBeenCalled();
    });

    test("should call beforeDelete and afterDelete hooks when provided", async () => {
        globalThis.fetch = mockFetchDeleteSuccess();

        const beforeDelete = vi.fn<any>().mockResolvedValue(undefined);
        const afterDelete = vi.fn<any>().mockResolvedValue(undefined);

        const existingTenant = {
            id: "rec-hk",
            tenantId: "user-hk",
            databaseId: "hk-db-uuid",
            databaseName: "DB_20240101_hookhook",
            shardHash: null,
            status: TenantDatabaseStatus.ACTIVE,
        };

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(existingTenant),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            hooks: { beforeDelete, afterDelete },
        }) as any;

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );

        await deleteHook.handler({
            context: {
                adapter,
                returned: { user: { id: "user-hk" } },
            },
        });

        expect(beforeDelete).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "user-hk", databaseId: "hk-db-uuid" })
        );
        expect(afterDelete).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: "user-hk", mode: "user" })
        );
    });
});

// ---------------------------------------------------------------------------
// Organization mode hooks
// ---------------------------------------------------------------------------
describe("cloudflareD1MultiTenancy organization mode hooks", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
        mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("create hook should match /organization/create path", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;
        const createHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/create" })
        );
        expect(createHook).toBeDefined();
    });

    test("delete hook should match /organization/delete path", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;
        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/delete" })
        );
        expect(deleteHook).toBeDefined();
    });

    test("create hook should not match /delete-user path", () => {
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;
        const matchesDeleteUser = plugin.hooks.after.some((h: any) =>
            h.matcher({ path: "/delete-user" })
        );
        expect(matchesDeleteUser).toBe(false);
    });

    test("should create tenant database when organization is created", async () => {
        globalThis.fetch = mockFetchSuccess("org-db-uuid");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-org" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;

        const createHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/create" })
        );

        await createHook.handler({
            context: {
                adapter,
                returned: { data: { id: "org-1" } },
                session: { user: { id: "user-1" } },
            },
        });

        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tenantId: "org-1",
                    tenantType: "organization",
                }),
            })
        );
    });

    test("should delete tenant database when organization is deleted", async () => {
        globalThis.fetch = mockFetchDeleteSuccess();

        const existingTenant = {
            id: "rec-org-del",
            tenantId: "org-del",
            databaseId: "org-del-db-uuid",
            databaseName: "DB_20240101_orgdel",
            shardHash: null,
            status: TenantDatabaseStatus.ACTIVE,
        };

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(existingTenant),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/delete" })
        );

        await deleteHook.handler({
            context: {
                adapter,
                session: { user: { id: "user-1" } },
            },
            body: { organizationId: "org-del" },
        });

        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({ status: TenantDatabaseStatus.DELETED }),
            })
        );
    });

    test("should try alternate org ID fields (organization, returned)", async () => {
        globalThis.fetch = mockFetchSuccess("org-alt-uuid");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-alt" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;

        const createHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/create" })
        );

        // returned.organization form
        await createHook.handler({
            context: {
                adapter,
                returned: { organization: { id: "org-alt" } },
                session: null,
            },
        });

        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ tenantId: "org-alt" }),
            })
        );
    });
});

// ---------------------------------------------------------------------------
// Shard cache population after database creation
// ---------------------------------------------------------------------------
describe("Shard cache after tenant creation", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
        mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should populate shard cache after successful database creation", async () => {
        const { getShardCache } = await import("../shard-cache");

        globalThis.fetch = mockFetchSuccess("shard-db-uuid");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-shard" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-shard", email: "s@b.com" },
            { context: { adapter } }
        );

        const cache = getShardCache();
        // Cache should have been populated with the new shard entry
        expect(cache.size()).toBeGreaterThan(0);
    });
});
