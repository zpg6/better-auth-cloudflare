/**
 * Tests for the cloudflareD1MultiTenancy plugin (index.ts)
 *
 * Uses real D1 via wrangler local persistence for SQL execution.
 * Fetch is intercepted by setup.ts (createLocalD1Fetch) for Cloudflare REST
 * API calls (create/delete database) — no HTTP mocking required here.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { getD1Pool, makeAdapter, tableExists, queryD1, assertD1FilesExist, createErrorD1Fetch, listTables } from "./helpers";

// ---------------------------------------------------------------------------
// Mock d1-http → real d1 binding driver
// ---------------------------------------------------------------------------
vi.mock("@zpg6-test-pkgs/drizzle-orm/d1-http", async () => {
    const { drizzle: d1Drizzle } = await import("@zpg6-test-pkgs/drizzle-orm/d1");
    return {
        drizzle: (config: any, options?: any) => {
            const pool = (globalThis as any).__d1TestPool;
            const binding = pool.allocate(config.databaseId);
            return d1Drizzle(binding, options);
        },
    };
});

import {
    cloudflareD1MultiTenancy,
    createTenantDatabaseClient,
    TenantDatabaseStatus,
} from "../index";
import { CloudflareD1MultiTenancyError } from "../utils";

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------
const cloudflareD1Api = { apiToken: "test-token", accountId: "test-account" };

// ---------------------------------------------------------------------------
// createTenantDatabaseClient
// ---------------------------------------------------------------------------
describe("createTenantDatabaseClient", () => {
    test("should return a drizzle database client backed by real D1", () => {
        const client = createTenantDatabaseClient("acct-123", "client-test-db-001", "my-token");
        expect(client).toBeDefined();
        expect(typeof client.run).toBe("function");
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
    test("should create a tenant database for a new user", async () => {
        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue(null),
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
                    databaseId: expect.any(String),
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
                databaseId: expect.any(String),
                mode: "user",
            })
        );
    });

    test("should initialize tenant database with migrations and verify real SQL", async () => {
        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-mig" }),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: "CREATE TABLE tenant_docs (id TEXT PRIMARY KEY, title TEXT);",
                currentVersion: "v1.0.0",
            },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-mig", email: "m@b.com" },
            { context: { adapter } }
        );

        // Get the databaseId from the adapter.update call and look up the real binding
        const updateCall = adapter.update.mock.calls[0][0];
        const databaseId = updateCall.update.databaseId;
        expect(databaseId).toBeDefined();

        const pool = getD1Pool();
        const binding = pool.get(databaseId);
        expect(binding).toBeDefined();
        expect(await tableExists(binding, "tenant_docs")).toBe(true);
    });

    test("should throw CloudflareD1MultiTenancyError when fetch fails", async () => {
        globalThis.fetch = createErrorD1Fetch({ networkError: "network error" });

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
    test("should delete an active tenant database", async () => {
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

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );
        expect(deleteHook).toBeDefined();

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
        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-alt" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "organization" }) as any;

        const createHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/create" })
        );

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
    test("should populate shard cache after successful database creation", async () => {
        const { getShardCache } = await import("../shard-cache");

        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-shard" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-shard", email: "s@b.com" },
            { context: { adapter } }
        );

        const cache = getShardCache();
        expect(cache.size()).toBeGreaterThan(0);
    });
});
