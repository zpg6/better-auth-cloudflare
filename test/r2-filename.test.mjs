import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { withCloudflare } from "../dist/index.mjs";

const origin = "http://localhost";

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

async function downloadDisposition(xFilename) {
    const auth = betterAuth({
        baseURL: origin,
        secret: "r2-filename-test-secret-at-least-32-chars",
        emailAndPassword: { enabled: true },
        ...withCloudflare(
            {
                autoDetectIpAddress: false,
                geolocationTracking: false,
                r2: { bucket: createBucket(), allowedTypes: [".txt"] },
            },
            { database: memoryAdapter({ user: [], session: [], account: [], verification: [], userFile: [] }) }
        ),
    });
    const signUp = await call(auth, "/sign-up/email", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery" }),
    });
    const cookie = signUp.headers.get("set-cookie").split(";")[0];

    const upload = await call(
        auth,
        "/files/upload-raw",
        { headers: { "content-type": "text/plain", "x-filename": xFilename }, body: "hi" },
        cookie
    );
    assert.equal(upload.status, 200);
    const { data } = await upload.json();

    const download = await call(
        auth,
        "/files/download",
        { headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: data.id }) },
        cookie
    );
    assert.equal(download.status, 200);
    return download.headers.get("content-disposition");
}

// RFC 5987 ext-value: only attr-char and pct-encoded, so no ";" or quote can split the header.
function decodedFilename(disposition) {
    const match = disposition.match(/^attachment; filename\*=UTF-8''([A-Za-z0-9%!#$&+.^_`|~-]*)$/);
    assert.ok(match, disposition);
    return decodeURIComponent(match[1]);
}

describe("R2 download Content-Disposition", () => {
    it("carries an injected filename as one opaque parameter", async () => {
        const name = `x.html"; filename*=UTF-8''evil.html; y=.txt`;
        assert.equal(decodedFilename(await downloadDisposition(name)), name);
    });

    it("round-trips a percent-encoded unicode filename", async () => {
        const name = "héllo 文件 (1).txt";
        assert.equal(decodedFilename(await downloadDisposition(encodeURIComponent(name))), name);
    });

    it("keeps a raw filename from older clients that is not valid percent-encoding", async () => {
        assert.equal(decodedFilename(await downloadDisposition("100%.txt")), "100%.txt");
    });
});
