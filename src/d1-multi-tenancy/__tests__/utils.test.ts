/**
 * Tests for D1 Multi-Tenancy Utility Functions
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
    CloudflareD1MultiTenancyError,
    CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES,
    validateCloudflareCredentials,
    createD1Database,
    deleteD1Database,
    getCloudflareD1TenantDatabaseName,
} from "../utils";

// ---------------------------------------------------------------------------
// CloudflareD1MultiTenancyError
// ---------------------------------------------------------------------------
describe("CloudflareD1MultiTenancyError", () => {
    test("should create error with code and default message", () => {
        const error = new CloudflareD1MultiTenancyError("MISSING_API_TOKEN");

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(CloudflareD1MultiTenancyError);
        expect(error.name).toBe("CloudflareD1MultiTenancyError");
        expect(error.code).toBe("MISSING_API_TOKEN");
        expect(error.message).toBe(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.MISSING_API_TOKEN);
    });

    test("should create error with custom message", () => {
        const customMessage = "Custom error message";
        const error = new CloudflareD1MultiTenancyError("DATABASE_CREATION_FAILED", customMessage);

        expect(error.code).toBe("DATABASE_CREATION_FAILED");
        expect(error.message).toBe(customMessage);
    });

    test("should create errors for all valid codes", () => {
        const codes = Object.keys(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES) as Array<
            keyof typeof CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES
        >;

        for (const code of codes) {
            const error = new CloudflareD1MultiTenancyError(code);
            expect(error.code).toBe(code);
            expect(error.message).toBe(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES[code]);
        }
    });
});

// ---------------------------------------------------------------------------
// validateCloudflareCredentials
// ---------------------------------------------------------------------------
describe("validateCloudflareCredentials", () => {
    test("should not throw with valid credentials", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "acct123" })
        ).not.toThrow();
    });

    test("should throw MISSING_API_TOKEN when apiToken is empty string", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "", accountId: "acct123" })
        ).toThrow(CloudflareD1MultiTenancyError);

        try {
            validateCloudflareCredentials({ apiToken: "", accountId: "acct123" });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("MISSING_API_TOKEN");
        }
    });

    test("should throw MISSING_API_TOKEN when apiToken is whitespace only", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "   ", accountId: "acct123" })
        ).toThrow(CloudflareD1MultiTenancyError);
    });

    test("should throw MISSING_ACCOUNT_ID when accountId is empty string", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "" })
        ).toThrow(CloudflareD1MultiTenancyError);

        try {
            validateCloudflareCredentials({ apiToken: "token123", accountId: "" });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("MISSING_ACCOUNT_ID");
        }
    });

    test("should throw MISSING_ACCOUNT_ID when accountId is whitespace only", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "  " })
        ).toThrow(CloudflareD1MultiTenancyError);
    });
});

// ---------------------------------------------------------------------------
// createD1Database – fetch is mocked
// ---------------------------------------------------------------------------
describe("createD1Database", () => {
    const config = { apiToken: "test-token", accountId: "test-account" };

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should return database UUID on success", async () => {
        const mockUuid = "2910d945-4dc7-4346-b0a9-2a14785ef92b";

        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                result: { uuid: mockUuid, name: "DB_20240101_abc12345" },
                errors: [],
            }),
        } as any);

        const result = await createD1Database(config, "DB_20240101_abc12345");

        expect(result).toBe(mockUuid);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining("test-account"),
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                }),
            })
        );
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when response is not ok", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
        } as any);

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when API returns errors array", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: false,
                errors: [{ code: 1001, message: "Database already exists" }],
            }),
        } as any);

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );
    });

    test("should throw CloudflareD1MultiTenancyError when uuid is missing from response", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                result: { name: "DB_test" }, // uuid missing
                errors: [],
            }),
        } as any);

        // The internal DATABASE_CREATION_FAILED throw is caught by the outer handler
        // and re-thrown as CLOUDFLARE_D1_API_ERROR
        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );
    });

    test("should throw INVALID_CREDENTIALS when fetch throws authentication error", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(
            new Error("authentication failed")
        );

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });

    test("should throw INVALID_CREDENTIALS when fetch throws unauthorized error", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(
            new Error("unauthorized access")
        );

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });
});

// ---------------------------------------------------------------------------
// deleteD1Database – fetch is mocked
// ---------------------------------------------------------------------------
describe("deleteD1Database", () => {
    const config = { apiToken: "test-token", accountId: "test-account" };

    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should resolve without error on success", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, result: null, errors: [] }),
        } as any);

        await expect(deleteD1Database(config, "db-uuid-123")).resolves.toBeUndefined();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            expect.stringContaining("db-uuid-123"),
            expect.objectContaining({ method: "DELETE" })
        );
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when response is not ok", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
            text: async () => "Database not found",
        } as any);

        await expect(deleteD1Database(config, "db-uuid-123")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await deleteD1Database(config, "db-uuid-123");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when API returns errors array", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: false,
                errors: [{ code: 1001, message: "Database not found" }],
            }),
        } as any);

        await expect(deleteD1Database(config, "db-uuid-123")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );
    });

    test("should throw INVALID_CREDENTIALS when fetch throws authentication error", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(
            new Error("authentication error")
        );

        await expect(deleteD1Database(config, "db-uuid-123")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await deleteD1Database(config, "db-uuid-123");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });
});

// ---------------------------------------------------------------------------
// getCloudflareD1TenantDatabaseName
// ---------------------------------------------------------------------------
describe("getCloudflareD1TenantDatabaseName", () => {
    test("should return name in DB_{YYYYMMDD}_{hash} format by default", () => {
        const name = getCloudflareD1TenantDatabaseName("user_12345");

        expect(name).toMatch(/^DB_\d{8}_[a-z0-9]+$/);
    });

    test("should use provided prefix", () => {
        const name = getCloudflareD1TenantDatabaseName("user_12345", "TENANT");

        expect(name).toMatch(/^TENANT_\d{8}_[a-z0-9]+$/);
    });

    test("should produce the same name for the same tenant ID (deterministic hash)", () => {
        const name1 = getCloudflareD1TenantDatabaseName("org_abc");
        const name2 = getCloudflareD1TenantDatabaseName("org_abc");

        // Hash part should always be identical
        const hash1 = name1.split("_")[2];
        const hash2 = name2.split("_")[2];
        expect(hash1).toBe(hash2);
    });

    test("should produce different hashes for different tenant IDs", () => {
        const name1 = getCloudflareD1TenantDatabaseName("user_aaa");
        const name2 = getCloudflareD1TenantDatabaseName("user_bbb");

        const hash1 = name1.split("_")[2];
        const hash2 = name2.split("_")[2];
        expect(hash1).not.toBe(hash2);
    });

    test("should include today's year in the date part", () => {
        const name = getCloudflareD1TenantDatabaseName("tenant_xyz");
        const datePart = name.split("_")[1];

        const year = parseInt(datePart.substring(0, 4));
        expect(year).toBe(new Date().getFullYear());
    });
});
