/**
 * Tests for Schema Detection and Validation
 */

import { describe, test, expect } from "vitest";
import {
    detectSchemas,
    analyzeCrossDbReferences,
    validateMultiTenancySchema,
} from "../schema-detection";

describe("Schema Detection", () => {
    describe("detectSchemas", () => {
        test("should separate main and tenant schemas correctly", () => {
            const fullSchema = {
                user: { /* def */ },
                users: { /* def */ },
                account: { /* def */ },
                userBirthday: { /* def */ },
                birthdayReminder: { /* def */ },
            };

            const coreModels = new Set(["user", "users", "account", "accounts"]);

            const result = detectSchemas({ schema: fullSchema, coreModels });

            expect(Object.keys(result.mainSchema)).toEqual(["user", "users", "account"]);
            expect(Object.keys(result.tenantSchema)).toEqual(["userBirthday", "birthdayReminder"]);
        });

        test("should warn about tenant tables without tenantId", () => {
            const fullSchema = {
                user: { /* def */ },
                myTable: { someField: "value" }, // No tenantId
            };

            const coreModels = new Set(["user"]);

            const result = detectSchemas({ schema: fullSchema, coreModels });

            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings[0]).toContain("myTable");
            expect(result.warnings[0]).toContain("tenantId field");
        });

        test("should handle empty tenant schema", () => {
            const fullSchema = {
                user: { /* def */ },
                account: { /* def */ },
            };

            const coreModels = new Set(["user", "account"]);

            const result = detectSchemas({ schema: fullSchema, coreModels });

            expect(Object.keys(result.mainSchema)).toHaveLength(2);
            expect(Object.keys(result.tenantSchema)).toHaveLength(0);
        });

        test("should handle complex schema with plugins", () => {
            const fullSchema = {
                user: { /* def */ },
                account: { /* def */ },
                twoFactor: { /* def */ },
                apiKey: { /* def */ },
                userBirthday: { tenantId: "string" },
                document: { tenantId: "string" },
            };

            const coreModels = new Set(["user", "account", "twoFactor", "apiKey"]);

            const result = detectSchemas({ schema: fullSchema, coreModels });

            expect(Object.keys(result.mainSchema)).toEqual(["user", "account", "twoFactor", "apiKey"]);
            expect(Object.keys(result.tenantSchema)).toEqual(["userBirthday", "document"]);
        });
    });

    describe("analyzeCrossDbReferences", () => {
        test("should detect userId reference from tenant to main", () => {
            const mainSchema = {
                user: { /* def */ },
                account: { /* def */ },
            };

            const tenantSchema = {
                userBirthday: {
                    userId: "string",
                    tenantId: "string",
                },
            };

            const issues = analyzeCrossDbReferences(mainSchema, tenantSchema);

            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("userBirthday");
            expect(issues[0]).toContain("userId");
            expect(issues[0]).toContain("user");
        });

        test("should detect multiple references", () => {
            const mainSchema = {
                user: { /* def */ },
                organization: { /* def */ },
            };

            const tenantSchema = {
                document: {
                    userId: "string",
                    organizationId: "string",
                    tenantId: "string",
                },
            };

            const issues = analyzeCrossDbReferences(mainSchema, tenantSchema);

            expect(issues.length).toBe(2); // userId and organizationId
            expect(issues.some(i => i.includes("userId"))).toBe(true);
            expect(issues.some(i => i.includes("organizationId"))).toBe(true);
        });

        test("should handle snake_case field names", () => {
            const mainSchema = {
                user: { /* def */ },
            };

            const tenantSchema = {
                userBirthday: {
                    user_id: "string",
                    tenant_id: "string",
                },
            };

            const issues = analyzeCrossDbReferences(mainSchema, tenantSchema);

            expect(issues.length).toBeGreaterThan(0);
            expect(issues[0]).toContain("user_id");
        });

        test("should not flag references between tenant tables", () => {
            const mainSchema = {
                user: { /* def */ },
            };

            const tenantSchema = {
                userBirthday: {
                    id: "string",
                    tenantId: "string",
                },
                birthdayReminder: {
                    userBirthdayId: "string",  // References another tenant table
                    tenantId: "string",
                },
            };

            const issues = analyzeCrossDbReferences(mainSchema, tenantSchema);

            // userBirthdayId should not be flagged as it references a tenant table
            expect(issues.length).toBe(0);
        });

        test("should handle empty schemas", () => {
            const issues = analyzeCrossDbReferences({}, {});
            expect(issues).toHaveLength(0);
        });
    });

    describe("validateMultiTenancySchema", () => {
        test("should validate a correct schema", () => {
            const fullSchema = {
                user: { /* def */ },
                tenant: { /* def */ },
                account: { /* def */ },
                userBirthday: { tenantId: "string" },
            };

            const coreModels = new Set(["user", "tenant", "account"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test("should error if required tables are missing", () => {
            const fullSchema = {
                account: { /* def */ },
                // Missing user and tenant tables
            };

            const coreModels = new Set(["account"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors.some(e => e.includes("user"))).toBe(true);
            expect(result.errors.some(e => e.includes("tenant"))).toBe(true);
        });

        test("should warn if no tenant tables exist", () => {
            const fullSchema = {
                user: { /* def */ },
                tenant: { /* def */ },
                account: { /* def */ },
            };

            const coreModels = new Set(["user", "tenant", "account"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings.some(w => w.includes("No tenant tables"))).toBe(true);
        });

        test("should warn about cross-database references", () => {
            const fullSchema = {
                user: { /* def */ },
                tenant: { /* def */ },
                userBirthday: {
                    userId: "string",  // References main.user
                    tenantId: "string"
                },
            };

            const coreModels = new Set(["user", "tenant"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings.some(w => w.includes("userId"))).toBe(true);
        });

        test("should handle plural table names", () => {
            const fullSchema = {
                users: { /* def */ },
                tenants: { /* def */ },
                accounts: { /* def */ },
            };

            const coreModels = new Set(["users", "tenants", "accounts"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(true);
        });

        test("should provide comprehensive validation", () => {
            const fullSchema = {
                user: { /* def */ },
                tenant: { /* def */ },
                document: { userId: "string" },  // Missing tenantId, refs main table
            };

            const coreModels = new Set(["user", "tenant"]);

            const result = validateMultiTenancySchema(fullSchema, coreModels);

            expect(result.isValid).toBe(true);  // No errors, just warnings
            expect(result.warnings.length).toBeGreaterThan(1);
            // Should warn about missing tenantId and cross-db reference
        });
    });
});
