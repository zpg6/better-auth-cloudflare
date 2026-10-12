import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
            headers: { origin, ...(cookie && { cookie }), ...init.headers },
        })
    );
}

async function signedIn(r2) {
    const auth = betterAuth({
        baseURL: origin,
        secret: "r2-raw-body-test-secret-at-least-32-chars",
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

async function roundTrip(r2, type, filename, bytes) {
    const { auth, cookie } = await signedIn(r2);
    const upload = await call(
        auth,
        "/files/upload-raw",
        { headers: { "content-type": type, "x-filename": filename }, body: bytes },
        cookie
    );
    assert.equal(upload.status, 200, await upload.clone().text());
    const { data } = await upload.json();
    assert.equal(data.size, bytes.length);
    assert.equal(data.contentType, type);

    const download = await call(
        auth,
        "/files/download",
        { headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: data.id }) },
        cookie
    );
    assert.equal(download.status, 200);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
}

describe("R2 upload stores the raw request bytes", () => {
    for (const [type, filename] of [
        ["text/csv", "data.csv"],
        ["application/zip", "archive.zip"],
        ["text/plain", "binary.txt"],
        ["multipart/form-data;boundary=x", "form.bin"],
    ]) {
        it(`round-trips 256 random bytes sent as ${type}`, () =>
            roundTrip({}, type, filename, new Uint8Array(randomBytes(256))));
    }

    it("accepts an empty file", () => roundTrip({}, "text/plain", "empty.txt", new Uint8Array()));

    it("accepts an extension mime cannot map", () =>
        roundTrip(
            { allowedTypes: ["pdf", "docx"] },
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "report.docx",
            Uint8Array.of(1, 2, 3)
        ));

    it("rejects an extension outside allowedTypes", async () => {
        const { auth, cookie } = await signedIn({ allowedTypes: ["pdf", "docx"] });
        const upload = await call(
            auth,
            "/files/upload-raw",
            { headers: { "content-type": "application/pdf", "x-filename": "evil.exe" }, body: "MZ" },
            cookie
        );
        assert.equal(upload.status, 415);
        assert.match((await upload.json()).message, /File type not supported/);
    });
});
