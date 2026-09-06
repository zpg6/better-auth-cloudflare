import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
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

describe("R2 upload", () => {
    it("returns the id the file is stored under", async () => {
        const auth = betterAuth({
            baseURL: origin,
            secret: "r2-upload-test-secret-at-least-32-chars",
            emailAndPassword: { enabled: true },
            ...withCloudflare(
                {
                    autoDetectIpAddress: false,
                    geolocationTracking: false,
                    r2: { bucket: createBucket(), allowedTypes: [".png"] },
                },
                { database: memoryAdapter({ user: [], session: [], account: [], verification: [], userFile: [] }) }
            ),
        });

        const signUp = await call(auth, "/sign-up/email", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery" }),
        });
        assert.equal(signUp.status, 200);
        const cookie = signUp.headers.get("set-cookie").split(";")[0];

        const upload = await call(
            auth,
            "/files/upload-raw",
            { headers: { "content-type": "image/png", "x-filename": "probe.png" }, body: png },
            cookie
        );
        assert.equal(upload.status, 200);
        const { data } = await upload.json();

        const list = await call(auth, "/files/list", { method: "GET" }, cookie);
        const { files } = await list.json();
        assert.equal(files.length, 1);
        assert.equal(files[0].id, data.id);

        const download = await call(
            auth,
            "/files/download",
            { headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: data.id }) },
            cookie
        );
        assert.equal(download.status, 200);
        assert.equal(download.headers.get("content-type"), "image/png");
    });
});
