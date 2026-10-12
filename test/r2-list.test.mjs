import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/client";
import { cloudflareClient, withCloudflare } from "../dist/index.mjs";

const origin = "http://localhost";

async function seeded(count, hooks) {
    const db = { user: [], session: [], account: [], verification: [], userFile: [] };
    const auth = betterAuth({
        baseURL: origin,
        secret: "r2-list-test-secret-at-least-32-characters",
        emailAndPassword: { enabled: true },
        ...withCloudflare(
            { autoDetectIpAddress: false, geolocationTracking: false, r2: { bucket: {}, hooks } },
            { database: memoryAdapter(db) }
        ),
    });
    const signUp = await auth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery" }),
        })
    );
    const { user } = await signUp.json();
    for (let i = 1; i <= count; i++) {
        db.userFile.push({
            id: `f${i}`,
            userId: user.id,
            filename: `f${i}`,
            originalName: `f${i}`,
            contentType: "text/plain",
            size: 1,
            r2Key: `user-files/${user.id}/f${i}`,
            uploadedAt: new Date(Date.UTC(2026, 0, i)),
        });
    }
    return { auth, cookie: signUp.headers.get("set-cookie").split(";")[0] };
}

const list = (auth, cookie, query) =>
    auth.handler(
        new Request(`${origin}/api/auth/files/list?${new URLSearchParams(query)}`, { headers: { origin, cookie } })
    );

describe("R2 list", () => {
    it("pages through every file exactly once, newest first", async () => {
        const { auth, cookie } = await seeded(7);
        const ids = [];
        const more = [];
        let cursor;
        do {
            const res = await list(auth, cookie, { limit: "3", ...(cursor && { cursor }) });
            assert.equal(res.status, 200);
            const page = await res.json();
            ids.push(...page.files.map(f => f.id));
            more.push(page.hasMore);
            cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(ids, ["f7", "f6", "f5", "f4", "f3", "f2", "f1"]);
        assert.deepEqual(more, [true, true, false]);
    });

    it("rejects an unknown cursor", async () => {
        const { auth, cookie } = await seeded(3);
        assert.equal((await list(auth, cookie, { cursor: "bogus" })).status, 400);
    });

    for (const limit of ["0", "-1", "101", "1.5"]) {
        it(`rejects limit=${limit}`, async () => {
            const { auth, cookie } = await seeded(1);
            assert.equal((await list(auth, cookie, { limit })).status, 400);
        });
    }

    it("fires list hooks and honors a null from before", async () => {
        const seen = [];
        const { auth, cookie } = await seeded(2, {
            list: {
                before: () => (seen.length ? null : undefined),
                after: (_, files) => seen.push(files.objects.map(o => o.key)),
            },
        });
        assert.equal((await list(auth, cookie, {})).status, 200);
        assert.equal(seen.length, 1);
        assert.match(seen[0][0], /\/f2$/);
        assert.equal((await list(auth, cookie, {})).status, 403);
    });

    it("client files.list sends GET with the query", async () => {
        const { auth, cookie } = await seeded(5);
        const methods = [];
        const client = createAuthClient({
            baseURL: origin,
            plugins: [cloudflareClient()],
            fetchOptions: {
                headers: { origin, cookie },
                customFetchImpl: (url, init) => {
                    methods.push(init.method);
                    return auth.handler(new Request(url, init));
                },
            },
        });
        const ids = [];
        let cursor;
        do {
            const { data, error } = await client.files.list({ query: { limit: 2, ...(cursor && { cursor }) } });
            assert.equal(error, null);
            ids.push(...data.files.map(f => f.id));
            cursor = data.nextCursor;
        } while (cursor);
        assert.deepEqual(ids, ["f5", "f4", "f3", "f2", "f1"]);
        assert.deepEqual(new Set(methods), new Set(["GET"]));
    });
});
