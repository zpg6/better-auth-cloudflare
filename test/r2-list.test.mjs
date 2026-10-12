import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/client";
import { cloudflareClient, withCloudflare } from "../dist/index.mjs";

const origin = "http://localhost";

async function seeded(count, hooks, at = i => Date.UTC(2026, 0, i)) {
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
            uploadedAt: new Date(at(i)),
        });
    }
    return { auth, db, cookie: signUp.headers.get("set-cookie").split(";")[0] };
}

const list = (auth, cookie, query) =>
    auth.handler(
        new Request(`${origin}/api/auth/files/list?${new URLSearchParams(query)}`, { headers: { origin, cookie } })
    );

async function pages(auth, cookie, limit) {
    const ids = [];
    const more = [];
    let cursor;
    do {
        const res = await list(auth, cookie, { limit, ...(cursor && { cursor }) });
        assert.equal(res.status, 200);
        const page = await res.json();
        ids.push(...page.files.map(f => f.id));
        more.push(page.hasMore);
        cursor = page.nextCursor;
    } while (cursor);
    return { ids, more };
}

describe("R2 list", () => {
    it("pages through every file exactly once, newest first", async () => {
        const { auth, cookie } = await seeded(7);
        assert.deepEqual(await pages(auth, cookie, "3"), {
            ids: ["f7", "f6", "f5", "f4", "f3", "f2", "f1"],
            more: [true, true, false],
        });
    });

    it("pages through uploads sharing a millisecond exactly once", async () => {
        const { auth, cookie } = await seeded(10, undefined, () => Date.UTC(2026, 0, 1));
        assert.deepEqual(await pages(auth, cookie, "3"), {
            ids: ["f9", "f8", "f7", "f6", "f5", "f4", "f3", "f2", "f10", "f1"],
            more: [true, true, true, false],
        });
    });

    it("pages through mixed millisecond groups exactly once", async () => {
        const { auth, cookie } = await seeded(13, undefined, i => Date.UTC(2026, 0, i === 1 ? 1 : i < 12 ? 2 : 3));
        assert.deepEqual(await pages(auth, cookie, "3"), {
            ids: ["f13", "f12", "f9", "f8", "f7", "f6", "f5", "f4", "f3", "f2", "f11", "f10", "f1"],
            more: [true, true, true, true, false],
        });
    });

    it("continues from a cursor whose file was deleted", async () => {
        const { auth, db, cookie } = await seeded(5);
        const { nextCursor } = await (await list(auth, cookie, { limit: "2" })).json();
        db.userFile.splice(
            db.userFile.findIndex(f => f.id === "f4"),
            1
        );
        const page = await (await list(auth, cookie, { limit: "2", cursor: nextCursor })).json();
        assert.deepEqual(
            page.files.map(f => f.id),
            ["f3", "f2"]
        );
    });

    for (const cursor of ["bogus", "f1", ":f1", "12:"]) {
        it(`rejects cursor=${cursor}`, async () => {
            const { auth, cookie } = await seeded(3);
            assert.equal((await list(auth, cookie, { cursor })).status, 400);
        });
    }

    it("clamps limit to 100", async () => {
        const { auth, cookie } = await seeded(101);
        const page = await (await list(auth, cookie, { limit: "101" })).json();
        assert.equal(page.files.length, 100);
        assert.equal(page.hasMore, true);
    });

    for (const limit of ["0", "-1", "1.5"]) {
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

    it("passes an APIError from the after hook through", async () => {
        const { auth, cookie } = await seeded(1, {
            list: {
                after: () => {
                    throw new APIError("PAYMENT_REQUIRED");
                },
            },
        });
        assert.equal((await list(auth, cookie, {})).status, 402);
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
