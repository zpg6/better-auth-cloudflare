import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { replaceDemoCorsOrigin } from "../src/lib/helpers";

const HONO_TEMPLATE_SRC = readFileSync(join(__dirname, "../../examples/hono/src/index.ts"), "utf8");

const DEMO_URL = "better-auth-cloudflare-hono.zpg6.workers.dev";

const WILDCARD_VARIANT = HONO_TEMPLATE_SRC.replace(
    `origin: "https://${DEMO_URL}",`,
    'origin: "*", // In production, replace with your actual domain'
);

describe("replaceDemoCorsOrigin", () => {
    describe("demo URL variant", () => {
        test("removes the hardcoded demo URL", () => {
            const result = replaceDemoCorsOrigin(HONO_TEMPLATE_SRC);
            expect(result).not.toContain(DEMO_URL);
        });

        test("inserts dynamic origin callback", () => {
            const result = replaceDemoCorsOrigin(HONO_TEMPLATE_SRC);
            expect(result).toContain("origin: (requestOrigin: string, c) =>");
            expect(result).toContain("new URL(c.req.url).origin");
        });

        test("produces syntactically valid CORS block", () => {
            const result = replaceDemoCorsOrigin(HONO_TEMPLATE_SRC);
            const corsBlockMatch = result.match(/cors\(\{([\s\S]*?)\}\)/);
            expect(corsBlockMatch).not.toBeNull();
            const corsBody = corsBlockMatch![1];
            expect(corsBody).toContain("origin:");
            expect(corsBody).toContain("allowHeaders:");
            expect(corsBody).toContain("credentials:");
        });
    });

    describe('wildcard variant (origin: "*")', () => {
        test("removes the wildcard origin", () => {
            const result = replaceDemoCorsOrigin(WILDCARD_VARIANT);
            expect(result).not.toContain('origin: "*"');
        });

        test("inserts dynamic origin callback", () => {
            const result = replaceDemoCorsOrigin(WILDCARD_VARIANT);
            expect(result).toContain("origin: (requestOrigin: string, c) =>");
            expect(result).toContain("new URL(c.req.url).origin");
        });

        test("produces syntactically valid CORS block", () => {
            const result = replaceDemoCorsOrigin(WILDCARD_VARIANT);
            const corsBlockMatch = result.match(/cors\(\{([\s\S]*?)\}\)/);
            expect(corsBlockMatch).not.toBeNull();
            const corsBody = corsBlockMatch![1];
            expect(corsBody).toContain("origin:");
            expect(corsBody).toContain("allowHeaders:");
            expect(corsBody).toContain("credentials:");
        });
    });

    test("does NOT run on NextJS template content (no-op for unrelated files)", () => {
        const nextjsContent = `
import { NextResponse } from "next/server";
export async function middleware(request) {
    return NextResponse.next();
}
`;
        const result = replaceDemoCorsOrigin(nextjsContent);
        expect(result).toBe(nextjsContent);
    });

    test("is idempotent — second call is a no-op", () => {
        const first = replaceDemoCorsOrigin(HONO_TEMPLATE_SRC);
        const second = replaceDemoCorsOrigin(first);
        expect(second).toBe(first);
    });

    test("is idempotent for wildcard variant", () => {
        const first = replaceDemoCorsOrigin(WILDCARD_VARIANT);
        const second = replaceDemoCorsOrigin(first);
        expect(second).toBe(first);
    });

    test("does not corrupt the file when neither pattern is present", () => {
        const alreadyEdited = HONO_TEMPLATE_SRC.replace(
            `origin: "https://${DEMO_URL}",`,
            'origin: "https://my-custom-domain.com",'
        );
        const result = replaceDemoCorsOrigin(alreadyEdited);
        expect(result).toBe(alreadyEdited);
        expect(result).toContain('origin: "https://my-custom-domain.com"');
    });
});
