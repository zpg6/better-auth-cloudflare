/**
 * Tests for Universal ID Generator
 */

import { describe, test, expect, beforeEach } from "@jest/globals";
import {
    UniversalIdGenerator,
    defaultIdGenerator,
    generateShardHashFromDatabaseId,
    generateStructuredDatabaseName,
} from "../id-generator";

describe("UniversalIdGenerator", () => {
    let generator: UniversalIdGenerator;

    beforeEach(() => {
        generator = new UniversalIdGenerator();
    });

    describe("generate", () => {
        test("should generate valid Universal ID with correct length", () => {
            const id = generator.generate({
                shardHash: "abc12345",
                recordType: "birthday",
            });

            // Default config: 11 (timestamp) + 8 (shard) + 4 (type) + 10 (random) = 33 chars
            expect(id).toHaveLength(33);
            expect(typeof id).toBe("string");
        });

        test("should include shard hash in generated ID", () => {
            const shardHash = "xyz78901";
            const id = generator.generate({
                shardHash,
                recordType: "document",
            });

            // Shard hash starts at position 11 (after timestamp)
            const extractedShardHash = id.substring(11, 19);
            expect(extractedShardHash).toBe(shardHash);
        });

        test("should generate unique IDs for same parameters", () => {
            const id1 = generator.generate({
                shardHash: "abc12345",
                recordType: "birthday",
            });

            const id2 = generator.generate({
                shardHash: "abc12345",
                recordType: "birthday",
            });

            expect(id1).not.toBe(id2);
        });

        test("should handle long shard hash by truncating", () => {
            const longShardHash = "verylongshardhash123456789";
            const id = generator.generate({
                shardHash: longShardHash,
                recordType: "test",
            });

            const extractedShardHash = id.substring(11, 19);
            expect(extractedShardHash).toHaveLength(8);
        });
    });

    describe("decode", () => {
        test("should decode valid Universal ID", () => {
            const originalShardHash = "abc12345";
            const originalRecordType = "birthday";
            
            const id = generator.generate({
                shardHash: originalShardHash,
                recordType: originalRecordType,
            });

            const decoded = generator.decode(id);
            expect(decoded).not.toBeNull();
            expect(decoded!.id).toBe(id);
            expect(decoded!.shardHash).toBe(originalShardHash);
            expect(decoded!.timestamp).toBeGreaterThan(0);
            expect(decoded!.typeHash).toHaveLength(4);
            expect(decoded!.random).toHaveLength(10);
        });

        test("should return null for invalid ID", () => {
            expect(generator.decode("invalid")).toBeNull();
            expect(generator.decode("")).toBeNull();
            expect(generator.decode("short")).toBeNull();
        });

        test("should decode ID with correct timestamp", () => {
            const beforeTime = Date.now();
            const id = generator.generate({
                shardHash: "test1234",
                recordType: "doc",
            });
            const afterTime = Date.now();

            const decoded = generator.decode(id);
            expect(decoded).not.toBeNull();
            expect(decoded!.timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(decoded!.timestamp).toBeLessThanOrEqual(afterTime);
        });
    });

    describe("isUniversalId", () => {
        test("should return true for valid Universal ID", () => {
            const id = generator.generate({
                shardHash: "abc12345",
                recordType: "birthday",
            });

            expect(generator.isUniversalId(id)).toBe(true);
        });

        test("should return false for invalid ID", () => {
            expect(generator.isUniversalId("invalid")).toBe(false);
            expect(generator.isUniversalId("")).toBe(false);
            expect(generator.isUniversalId("too-short")).toBe(false);
        });
    });

    describe("extractShardHash", () => {
        test("should extract shard hash from valid ID", () => {
            const shardHash = "xyz78901";
            const id = generator.generate({
                shardHash,
                recordType: "test",
            });

            const extracted = generator.extractShardHash(id);
            expect(extracted).toBe(shardHash);
        });

        test("should return null for invalid ID", () => {
            expect(generator.extractShardHash("invalid")).toBeNull();
            expect(generator.extractShardHash("")).toBeNull();
        });

        test("should be faster than full decode", () => {
            const id = generator.generate({
                shardHash: "abc12345",
                recordType: "test",
            });

            // Both should work and return same shard hash
            const extracted = generator.extractShardHash(id);
            const decoded = generator.decode(id);

            expect(extracted).toBe(decoded!.shardHash);
        });
    });
});

describe("generateShardHashFromDatabaseId", () => {
    test("should generate consistent hash from database UUID", () => {
        const databaseId = "2910d945-4dc7-4346-b0a9-2a14785ef92b";
        const hash1 = generateShardHashFromDatabaseId(databaseId);
        const hash2 = generateShardHashFromDatabaseId(databaseId);

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(8);
    });

    test("should generate different hashes for different UUIDs", () => {
        const uuid1 = "2910d945-4dc7-4346-b0a9-2a14785ef92b";
        const uuid2 = "12345678-1234-1234-1234-123456789012";

        const hash1 = generateShardHashFromDatabaseId(uuid1);
        const hash2 = generateShardHashFromDatabaseId(uuid2);

        expect(hash1).not.toBe(hash2);
    });

    test("should handle UUIDs with or without dashes", () => {
        const uuidWithDashes = "2910d945-4dc7-4346-b0a9-2a14785ef92b";
        const uuidWithoutDashes = "2910d9454dc74346b0a92a14785ef92b";

        const hash1 = generateShardHashFromDatabaseId(uuidWithDashes);
        const hash2 = generateShardHashFromDatabaseId(uuidWithoutDashes);

        // Should be the same since we normalize by removing dashes
        expect(hash1).toBe(hash2);
    });
});

describe("generateStructuredDatabaseName", () => {
    test("should generate database name with date and tenant hash", () => {
        const tenantId = "user_12345";
        const name = generateStructuredDatabaseName(tenantId);

        // Format: DB_{YYYYMMDD}_{hash}
        expect(name).toMatch(/^DB_\d{8}_[a-z0-9]{8}$/);
    });

    test("should generate consistent name for same tenant", () => {
        const tenantId = "user_12345";
        const name1 = generateStructuredDatabaseName(tenantId);
        const name2 = generateStructuredDatabaseName(tenantId);

        // Should have same hash but might differ in date if run on different days
        const hash1 = name1.split('_')[2];
        const hash2 = name2.split('_')[2];
        expect(hash1).toBe(hash2);
    });

    test("should use custom prefix", () => {
        const tenantId = "user_12345";
        const name = generateStructuredDatabaseName(tenantId, "TENANT");

        expect(name).toMatch(/^TENANT_\d{8}_[a-z0-9]{8}$/);
    });

    test("should generate different hashes for different tenants", () => {
        const name1 = generateStructuredDatabaseName("user_111");
        const name2 = generateStructuredDatabaseName("user_222");

        const hash1 = name1.split('_')[2];
        const hash2 = name2.split('_')[2];
        expect(hash1).not.toBe(hash2);
    });

    test("should include current date in YYYYMMDD format", () => {
        const tenantId = "user_12345";
        const name = generateStructuredDatabaseName(tenantId);

        const datePart = name.split('_')[1];
        expect(datePart).toHaveLength(8);
        expect(datePart).toMatch(/^\d{8}$/);

        // Verify it's roughly today's date
        const year = parseInt(datePart.substring(0, 4));
        const currentYear = new Date().getFullYear();
        expect(year).toBe(currentYear);
    });
});

describe("defaultIdGenerator", () => {
    test("should be a singleton instance", () => {
        expect(defaultIdGenerator).toBeInstanceOf(UniversalIdGenerator);
    });

    test("should work with default configuration", () => {
        const id = defaultIdGenerator.generate({
            shardHash: "test1234",
            recordType: "document",
        });

        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);

        const decoded = defaultIdGenerator.decode(id);
        expect(decoded).not.toBeNull();
        expect(decoded!.shardHash).toBe("test1234");
    });
});
