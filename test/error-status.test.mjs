import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { memoryAdapter } from "better-auth/adapters/memory";
import { withCloudflare } from "../dist/index.mjs";

const origin = "http://localhost";
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createBucket() {
    const objects = new Map();
    return {
        async put(key, body) {
            objects.set(key, body);
            return { key };
        },
        async get(key) {
            const body = objects.get(key);
            return body ? { body: new Blob([body]).stream() } : null;
        },
        async delete(key) {
            objects.delete(key);
        },
    };
}

function call(auth, path, init, cookie) {
    return auth.handler(
        new Request(`${origin}/api/auth${path}`, {
            method: "POST",
            ...init,
            headers: { origin, ...(cookie ? { cookie } : {}), ...init.headers },
        })
    );
}

async function signedIn(r2) {
    const auth = betterAuth({
        baseURL: origin,
        secret: "error-status-test-secret-at-least-32-chars",
        emailAndPassword: { enabled: true },
        ...withCloudflare(
            { autoDetectIpAddress: false, geolocationTracking: false, r2: { bucket: createBucket(), ...r2 } },
            { database: memoryAdapter({ user: [], session: [], account: [], verification: [], userFile: [] }) }
        ),
    });
    const signUp = await call(auth, "/sign-up/email", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery" }),
    });
    assert.equal(signUp.status, 200);
    return { auth, cookie: signUp.headers.get("set-cookie").split(";")[0] };
}

const upload = (auth, cookie, headers, body = png) =>
    call(auth, "/files/upload-raw", { headers: { "content-type": "image/png", ...headers }, body }, cookie);

const byId = (path, auth, cookie, fileId) =>
    call(auth, path, { headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId }) }, cookie);

describe("error status codes", () => {
    it("geolocation: 401 signed out, 404 without cf", async () => {
        const { auth, cookie } = await signedIn({});
        assert.equal((await call(auth, "/cloudflare/geolocation", { method: "GET" })).status, 401);
        assert.equal((await call(auth, "/cloudflare/geolocation", { method: "GET" }, cookie)).status, 404);
    });

    const additionalFields = { tag: { type: "string", required: true } };
    for (const [name, r2, headers, status] of [
        ["bad extension", { allowedTypes: [".png"] }, { "x-filename": "probe.txt" }, 415],
        ["missing x-filename", {}, {}, 400],
        ["empty x-filename", {}, { "x-filename": "" }, 400],
        ["bad metadata JSON", {}, { "x-filename": "p.png", "x-file-metadata": "{" }, 400],
        ["wrong field type", { additionalFields }, { "x-filename": "p.png", "x-file-metadata": '{"tag":1}' }, 400],
        ["missing required field", { additionalFields }, { "x-filename": "p.png" }, 400],
        ["file over maxFileSize", { maxFileSize: 4 }, { "x-filename": "p.png" }, 413],
    ]) {
        it(`upload: ${name} -> ${status}`, async () => {
            const { auth, cookie } = await signedIn(r2);
            assert.equal((await upload(auth, cookie, headers)).status, status);
        });
    }

    it("upload: stops reading a body without Content-Length once it exceeds maxFileSize", async () => {
        const { auth, cookie } = await signedIn({ maxFileSize: 10 });
        let pulls = 0;
        const body = new ReadableStream({
            pull: c => (++pulls > 100 ? c.close() : c.enqueue(new Uint8Array(4))),
        });
        const res = await call(
            auth,
            "/files/upload-raw",
            { headers: { "content-type": "image/png", "x-filename": "p.png" }, body, duplex: "half" },
            cookie
        );
        assert.equal(res.status, 413);
        assert.ok(pulls < 10, `pulled ${pulls} chunks`);
    });

    it("upload: hook APIError keeps its status", async () => {
        const { auth, cookie } = await signedIn({
            hooks: {
                upload: {
                    before: () => {
                        throw new APIError("FORBIDDEN");
                    },
                },
            },
        });
        assert.equal((await upload(auth, cookie, { "x-filename": "p.png" })).status, 403);
    });

    it("upload: storage failure -> 500 without the internal message", async () => {
        const bucket = {
            async put() {
                throw new Error("internal r2 detail");
            },
        };
        const { auth, cookie } = await signedIn({ bucket });
        const res = await upload(auth, cookie, { "x-filename": "p.png" });
        assert.equal(res.status, 500);
        assert.doesNotMatch(await res.text(), /internal r2 detail/);
    });

    it("upload: hook returning null -> 403", async () => {
        const { auth, cookie } = await signedIn({ hooks: { upload: { before: () => null } } });
        assert.equal((await upload(auth, cookie, { "x-filename": "p.png" })).status, 403);
    });

    for (const op of ["download", "delete"]) {
        it(`${op}: hook returning null -> 403`, async () => {
            const { auth, cookie } = await signedIn({ hooks: { [op]: { before: () => null } } });
            const { data } = await (await upload(auth, cookie, { "x-filename": "p.png" })).json();
            assert.equal((await byId(`/files/${op}`, auth, cookie, data.id)).status, 403);
        });
    }
});
