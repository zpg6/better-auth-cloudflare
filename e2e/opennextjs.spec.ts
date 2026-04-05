import {
    test,
    expect,
    request as pwRequest,
    type Page,
    type BrowserContext,
    type APIRequestContext,
    type APIResponse,
} from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE = "https://better-auth-cloudflare.zpg6.workers.dev";

async function signInAnonymous(api: APIRequestContext, retries = 5): Promise<APIResponse> {
    for (let i = 0; i < retries; i++) {
        const res = await api.post("/api/auth/sign-in/anonymous", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: {},
        });
        if (res.ok()) return res;
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
    throw new Error(`Anonymous sign-in failed after ${retries} retries (rate limited?)`);
}

test.describe("OpenNextJS Live Site", () => {
    test.describe.configure({ mode: "serial" });

    let ctx: BrowserContext;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        ctx = await browser.newContext();
        page = await ctx.newPage();
    });

    test.afterAll(async () => {
        await ctx.close();
    });

    // ── Landing page loads ─────────────────────────────────────────────
    test("landing page loads and shows Login button", async () => {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await expect(page.getByText("Login", { exact: true })).toBeVisible();
        await expect(page.getByText("Powered by better-auth-cloudflare", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Login Anonymously" })).toBeVisible();
    });

    // ── Unauthenticated /dashboard redirects to / ──────────────────────
    test("/dashboard redirects to / when not authenticated", async () => {
        const freshCtx = await page.context().browser()!.newContext();
        const freshPage = await freshCtx.newPage();
        await freshPage.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
        expect(freshPage.url()).not.toContain("/dashboard");
        await freshCtx.close();
    });

    // ── Browser-based anonymous login → dashboard redirect ─────────────
    test("clicking Login Anonymously navigates to /dashboard", async () => {
        await page.goto(BASE, { waitUntil: "networkidle" });

        if (page.url().includes("/dashboard")) {
            await expect(page.locator("text=Dashboard")).toBeVisible();
            return;
        }

        await page.getByRole("button", { name: "Login Anonymously" }).click();
        // The app does window.location.reload() after sign-in, then middleware redirects
        await expect(page.locator("text=Dashboard")).toBeVisible({ timeout: 30_000 });
        expect(page.url()).toContain("/dashboard");
    });

    // ── Dashboard shows user info ──────────────────────────────────────
    test("dashboard shows user info tab with session data", async () => {
        await expect(page.locator("text=Dashboard")).toBeVisible();
        await expect(page.locator("text=User Information")).toBeVisible();
        await expect(page.locator("text=Welcome,")).toBeVisible();
        await expect(page.locator("text=User ID:")).toBeVisible();
    });

    // ── Geolocation tab shows location data ────────────────────────────
    test("geolocation tab shows location data", async () => {
        await page.getByRole("tab", { name: "Geolocation" }).click();
        await expect(page.locator("text=Your Location")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("text=Timezone")).toBeVisible();
        await expect(page.locator("text=Data Center")).toBeVisible();
    });

    // ── GET /api/auth/get-session returns valid session ────────────────
    test("GET /api/auth/get-session returns session with geo fields", async () => {
        const res = await page.request.get(`${BASE}/api/auth/get-session`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.session).toBeTruthy();
        expect(body.user).toBeTruthy();
        expect(body.session.userId).toBeTruthy();
    });

    // ── Geolocation API ────────────────────────────────────────────────
    test("GET /api/auth/cloudflare/geolocation returns location", async () => {
        const res = await page.request.get(`${BASE}/api/auth/cloudflare/geolocation`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.timezone).toBeTruthy();
        expect(body.colo).toBeTruthy();
    });

    // ── File Upload tab loads ──────────────────────────────────────────
    test("file upload tab loads and shows upload form", async () => {
        await page.getByRole("tab", { name: "File Upload" }).click();
        await expect(page.locator("text=Select File")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("text=Your Files")).toBeVisible();
    });

    // ── File upload flow ───────────────────────────────────────────────
    test("uploading a file succeeds and appears in file list", async () => {
        const tmpDir = path.join(process.cwd(), "e2e", ".tmp");
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, "test-image.png");

        // 1x1 red PNG
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            "base64"
        );
        fs.writeFileSync(tmpFile, pngBytes);

        try {
            const fileInput = page.locator('input[type="file"]');
            await fileInput.setInputFiles(tmpFile);
            await expect(page.locator("text=test-image.png")).toBeVisible();

            await page.locator("#category").fill("e2e-test");
            await page.locator("#description").fill("Playwright E2E test upload");
            await page.locator("#isPublic").check();

            await page.locator("button:has-text('Upload File')").click();

            await expect(page.locator("text=File uploaded successfully")).toBeVisible({ timeout: 20_000 });
            await expect(page.locator("text=test-image.png")).toBeVisible({ timeout: 10_000 });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    // ── File list API ──────────────────────────────────────────────────
    test("GET /api/auth/files/list returns uploaded files", async () => {
        const res = await page.request.get(`${BASE}/api/auth/files/list`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.files).toBeInstanceOf(Array);
        expect(body.files.length).toBeGreaterThan(0);

        const testFile = body.files.find((f: { originalName: string }) => f.originalName === "test-image.png");
        expect(testFile).toBeTruthy();
        expect(testFile.category).toBe("e2e-test");
    });

    // ── Delete uploaded file ───────────────────────────────────────────
    test("deleting the uploaded file removes it from the list", async () => {
        const deleteBtn = page
            .locator("div")
            .filter({ hasText: "test-image.png" })
            .locator("button:has-text('Delete')")
            .first();

        await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
        await deleteBtn.click();
        await page.waitForTimeout(2000);
        await page.locator("button:has-text('Refresh')").click();
        await page.waitForTimeout(2000);

        // Verify the file is actually gone from the API
        const res = await page.request.get(`${BASE}/api/auth/files/list`);
        const body = await res.json();
        const stillThere = body.files?.find((f: { originalName: string }) => f.originalName === "test-image.png");
        expect(stillThere).toBeFalsy();
    });

    // ── Sign out redirects to / ────────────────────────────────────────
    test("clicking Sign Out returns to landing page", async () => {
        await page.getByRole("tab", { name: "User Info" }).click();
        await page.getByRole("button", { name: "Sign Out" }).click();
        await expect(page.getByRole("button", { name: "Login Anonymously" })).toBeVisible({ timeout: 15_000 });
    });

    // ── OpenAPI spec endpoint ──────────────────────────────────────────
    test("GET /api/auth/reference returns OpenAPI HTML", async () => {
        const res = await page.request.get(`${BASE}/api/auth/reference`);
        expect(res.ok()).toBe(true);
        const text = await res.text();
        expect(text).toContain("html");
    });
});

// ════════════════════════════════════════════════════════════════════════
// Penetration Tests — OpenNextJS
// ════════════════════════════════════════════════════════════════════════

test.describe("OpenNextJS Pen Tests", () => {
    let api: APIRequestContext;
    let authApi1: APIRequestContext;
    let authApi2: APIRequestContext;
    let signInHeaders: { name: string; value: string }[];

    test.beforeAll(async () => {
        api = await pwRequest.newContext({ baseURL: BASE });

        authApi1 = await pwRequest.newContext({ baseURL: BASE });
        const signInRes1 = await signInAnonymous(authApi1);
        signInHeaders = await signInRes1.headersArray();

        authApi2 = await pwRequest.newContext({ baseURL: BASE });
        await signInAnonymous(authApi2);
    });

    test.afterAll(async () => {
        await api.dispose();
        await authApi1.dispose();
        await authApi2.dispose();
    });

    // ── CSRF / Origin Validation ───────────────────────────────────────

    test("rejects sign-out with forged Origin header", async () => {
        const csrfApi = await pwRequest.newContext({ baseURL: BASE });
        await signInAnonymous(csrfApi);

        const res = await csrfApi.post("/api/auth/sign-out", {
            headers: {
                "Content-Type": "application/json",
                Origin: "https://evil-attacker.com",
            },
            data: {},
        });
        expect(res.ok()).toBe(false);
        await csrfApi.dispose();
    });

    test("rejects sign-out with mismatched Referer header", async () => {
        const csrfApi = await pwRequest.newContext({ baseURL: BASE });
        await signInAnonymous(csrfApi);

        const res = await csrfApi.post("/api/auth/sign-out", {
            headers: {
                "Content-Type": "application/json",
                Referer: "https://evil-attacker.com/phishing-page",
            },
            data: {},
        });
        expect(res.ok()).toBe(false);
        await csrfApi.dispose();
    });

    // ── Session Manipulation ───────────────────────────────────────────

    test("rejects request with forged session cookie", async () => {
        const res = await api.get("/api/auth/get-session", {
            headers: {
                Cookie: "better-auth.session_token=forged-session-id-00000000",
            },
        });
        const body = await res.text();
        expect(body === "" || body === "null" || !JSON.parse(body)?.session).toBe(true);
    });

    test("rejects request with tampered JWT-style token", async () => {
        const fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.invalid_signature";
        const res = await api.get("/api/auth/get-session", {
            headers: {
                Cookie: `better-auth.session_token=${fakeJwt}`,
            },
        });
        const body = await res.text();
        expect(body === "" || body === "null" || !JSON.parse(body)?.session).toBe(true);
    });

    test("rejects session cookie with SQL injection payload", async () => {
        const res = await api.get("/api/auth/get-session", {
            headers: {
                Cookie: "better-auth.session_token=' OR '1'='1",
            },
        });
        const body = await res.json().catch(() => null);
        expect(body?.session).toBeFalsy();
    });

    // ── SQL Injection ──────────────────────────────────────────────────

    test("sign-in endpoint is not vulnerable to SQL injection in body", async () => {
        const sqliApi = await pwRequest.newContext({ baseURL: BASE });
        const payloads = [
            { email: "' OR 1=1 --", password: "anything" },
            { email: "admin@test.com'; DROP TABLE users;--", password: "x" },
            { email: "test", password: "' UNION SELECT * FROM users --" },
        ];

        for (const payload of payloads) {
            const res = await sqliApi.post("/api/auth/sign-in/email", {
                headers: { "Content-Type": "application/json" },
                data: payload,
            });
            const text = await res.text();
            expect(text.toLowerCase()).not.toContain("syntax error");
            expect(text.toLowerCase()).not.toContain("sqlite");
            expect(text.toLowerCase()).not.toContain("sql");
            expect(text.toLowerCase()).not.toContain("database");
        }

        // Verify no injection payload granted a session
        const sessionRes = await sqliApi.get("/api/auth/get-session");
        const sessionBody = await sessionRes.json().catch(() => null);
        expect(sessionBody?.session).toBeFalsy();
        await sqliApi.dispose();
    });

    // ── NoSQL / JSON Injection ─────────────────────────────────────────

    test("sign-in rejects object-as-string injection", async () => {
        const res = await api.post("/api/auth/sign-in/email", {
            headers: { "Content-Type": "application/json" },
            data: {
                email: { $gt: "" },
                password: { $gt: "" },
            },
        });
        expect(res.ok()).toBe(false);
    });

    // ── Path Traversal ─────────────────────────────────────────────────

    test("auth routes reject path traversal", async () => {
        const paths = [
            "/api/auth/../../etc/passwd",
            "/api/auth/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "/api/auth/..%2f..%2f..%2fetc%2fpasswd",
            "/api/auth/get-session/../../admin",
        ];

        for (const p of paths) {
            const res = await api.get(p);
            const text = await res.text();
            expect(text).not.toContain("root:");
            expect(text).not.toContain("/bin/bash");
        }
    });

    // ── HTTP Method Tampering ──────────────────────────────────────────

    test("GET on sign-in/anonymous does not create a session", async () => {
        const res = await api.get("/api/auth/sign-in/anonymous");
        const text = await res.text();
        const createdUser =
            res.ok() &&
            (() => {
                try {
                    return JSON.parse(text)?.user;
                } catch {
                    return undefined;
                }
            })();
        expect(createdUser).toBeFalsy();
    });

    test("DELETE on sign-in endpoint does not create a session", async () => {
        const res = await api.delete("/api/auth/sign-in/anonymous");
        const text = await res.text();
        const createdUser =
            res.ok() &&
            (() => {
                try {
                    return JSON.parse(text)?.user;
                } catch {
                    return undefined;
                }
            })();
        expect(createdUser).toBeFalsy();
    });

    // ── Header Injection (CRLF) ────────────────────────────────────────

    test("CRLF injection in headers is blocked by HTTP client", async () => {
        await expect(
            api.get("/api/auth/get-session", {
                headers: {
                    "X-Custom": "value\r\nSet-Cookie: evil=true",
                },
            })
        ).rejects.toThrow(/Invalid character in header/);
    });

    // ── Cookie Security Flags ──────────────────────────────────────────

    test("session cookie has Secure, HttpOnly, and SameSite flags", async () => {
        const setCookies = signInHeaders.filter(h => h.name.toLowerCase() === "set-cookie").map(h => h.value);

        const sessionCookie = setCookies.find(
            c => c.includes("session") || c.includes("better-auth") || c.includes("auth")
        );
        expect(sessionCookie).toBeTruthy();

        const lower = sessionCookie!.toLowerCase();
        expect(lower).toContain("httponly");
        expect(lower).toContain("secure");
        expect(lower).toMatch(/samesite=(lax|strict|none)/);
    });

    // ── Information Disclosure ──────────────────────────────────────────

    test("error responses do not leak stack traces or internal paths", async () => {
        const res = await api.get("/api/auth/nonexistent-endpoint-12345");
        const text = await res.text();
        expect(text).not.toContain("node_modules");
        expect(text).not.toContain("at Object.");
        expect(text).not.toContain("at Module.");
        expect(text).not.toMatch(/\/Users\/|\/home\/|C:\\/);
    });

    test("404 response does not reveal server framework version", async () => {
        const res = await api.get("/this-path-does-not-exist-xyz");
        const poweredBy = res.headers()["x-powered-by"] ?? "";
        // Next.js should not expose its version
        expect(poweredBy).not.toMatch(/next\/\d/i);
    });

    // ── Oversized Payload ──────────────────────────────────────────────

    test("rejects excessively large JSON body", async () => {
        const largePayload = "A".repeat(10 * 1024 * 1024); // 10 MB
        const res = await api.post("/api/auth/sign-in/email", {
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ email: "test@example.com", password: "x", padding: largePayload }),
        });
        expect(res.status()).not.toBe(500);
        expect(res.status()).not.toBe(200);
    });

    // ── Middleware Auth Bypass ──────────────────────────────────────────

    test("cannot bypass middleware auth with X-Forwarded headers", async () => {
        const res = await api.get("/dashboard", {
            headers: {
                "X-Forwarded-For": "127.0.0.1",
                "X-Real-IP": "127.0.0.1",
                "X-Forwarded-Host": "localhost",
            },
            maxRedirects: 0,
        });
        expect(res.status()).not.toBe(200);
    });

    test("cannot bypass middleware with Host header spoofing", async () => {
        const res = await api.get("/dashboard", {
            headers: { Host: "localhost:3000" },
            maxRedirects: 0,
        });
        expect(res.status()).not.toBe(200);
    });

    // ── Content-Type Confusion ─────────────────────────────────────────

    test("sign-in rejects XML content-type masquerading as JSON", async () => {
        const res = await api.post("/api/auth/sign-in/anonymous", {
            headers: { "Content-Type": "application/xml" },
            data: "<user><admin>true</admin></user>",
        });
        const text = await res.text();
        let parsed: Record<string, unknown> | undefined;
        try {
            parsed = JSON.parse(text);
        } catch {
            /* non-JSON is fine */
        }
        if (parsed?.user) {
            expect((parsed.user as Record<string, unknown>).role).not.toBe("admin");
        }
        const sessionRes = await api.get("/api/auth/get-session");
        const body = await sessionRes.json().catch(() => null);
        expect(body?.session).toBeFalsy();
    });

    test("sign-in rejects form-urlencoded body", async () => {
        const res = await api.post("/api/auth/sign-in/anonymous", {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            data: "admin=true&role=superadmin",
        });
        const text = await res.text();
        let parsed: Record<string, unknown> | undefined;
        try {
            parsed = JSON.parse(text);
        } catch {
            /* non-JSON is fine */
        }
        if (parsed?.user) {
            expect((parsed.user as Record<string, unknown>).role).not.toBe("superadmin");
        }
        const sessionRes = await api.get("/api/auth/get-session");
        const body = await sessionRes.json().catch(() => null);
        expect(body?.session).toBeFalsy();
    });

    // ── Prototype Pollution ────────────────────────────────────────────

    test("JSON body with __proto__ does not pollute objects", async () => {
        const res = await api.post("/api/auth/sign-in/anonymous", {
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                __proto__: { isAdmin: true },
                constructor: { prototype: { isAdmin: true } },
            }),
        });
        expect(res.status()).not.toBe(500);

        const sessionRes = await authApi1.get("/api/auth/get-session");
        const body = await sessionRes.json().catch(() => null);
        expect(body?.user).toBeTruthy();
        expect(body.user.isAdmin).not.toBe(true);
        expect(body.user.role).not.toBe("admin");
    });

    // ── Open Redirect ──────────────────────────────────────────────────

    test("auth callback does not allow open redirect", async () => {
        const targets = [
            "/api/auth/callback?redirect=https://evil.com",
            "/api/auth/callback?callbackURL=https://evil.com",
            "/api/auth/callback?redirectTo=https://evil.com",
        ];
        for (const target of targets) {
            const res = await api.get(target, { maxRedirects: 0 });
            const location = res.headers()["location"] ?? "";
            expect(location).not.toContain("evil.com");
        }
    });

    // ── R2 File Upload Security ────────────────────────────────────────

    test("file upload rejects unauthenticated requests", async () => {
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            "base64"
        );
        const res = await api.post("/api/auth/files/upload-raw", {
            headers: { "x-filename": "hack.png", "Content-Type": "image/png", Origin: BASE },
            data: pngBytes,
        });
        expect(res.ok()).toBe(false);
    });

    test("file upload rejects disallowed file types", async () => {
        const res = await authApi1.post("/api/auth/files/upload-raw", {
            headers: { "x-filename": "malware.exe", "Content-Type": "application/x-msdownload", Origin: BASE },
            data: Buffer.from("MZ\x90\x00"),
        });
        expect(res.ok()).toBe(false);
        const body = await res.text();
        expect(body.toLowerCase()).toMatch(/invalid.*file.*type|unsupported|not.*allowed|supported formats/i);
    });

    test("file upload rejects or sanitizes path traversal in filename", async () => {
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            "base64"
        );
        const res = await authApi1.post("/api/auth/files/upload-raw", {
            headers: { "x-filename": "../../../etc/passwd.png", "Content-Type": "image/png", Origin: BASE },
            data: pngBytes,
        });

        if (res.ok()) {
            const body = await res.json();
            // The r2Key and filename are the security-critical fields (actual storage path)
            const r2Key = body.data?.r2Key ?? "";
            const filename = body.data?.filename ?? "";
            expect(r2Key).not.toMatch(/\.\.\//);
            expect(filename).not.toMatch(/\.\.\//);
            // r2Key should be scoped to the user's directory
            expect(r2Key).toMatch(/^user-files\//);

            const fileId = body.data?.id ?? body.id;
            if (fileId) {
                await authApi1.post("/api/auth/files/delete", {
                    headers: { "Content-Type": "application/json", Origin: BASE },
                    data: { fileId },
                });
            }
        }
    });

    test("file download rejects accessing other users' private files", async () => {
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            "base64"
        );
        const uploadRes = await authApi1.post("/api/auth/files/upload-raw", {
            headers: {
                "x-filename": "private-pentest.png",
                "x-file-metadata": JSON.stringify({ isPublic: false }),
                "Content-Type": "image/png",
                Origin: BASE,
            },
            data: pngBytes,
        });
        expect(uploadRes.ok()).toBe(true);

        const listRes = await authApi1.get("/api/auth/files/list");
        const listBody = await listRes.json();
        const file = listBody.files?.find((f: { originalName: string }) => f.originalName === "private-pentest.png");
        expect(file).toBeTruthy();

        // authApi2 (different user) tries to download authApi1's private file
        const stealRes = await authApi2.post("/api/auth/files/download", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: { fileId: file.id },
        });
        expect(stealRes.ok()).toBe(false);

        // Cleanup
        await authApi1.post("/api/auth/files/delete", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: { fileId: file.id },
        });
    });

    // ── IDOR on File Operations ────────────────────────────────────────

    test("cannot delete another user's files via IDOR", async () => {
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
            "base64"
        );
        const uploadRes = await authApi1.post("/api/auth/files/upload-raw", {
            headers: {
                "x-filename": "idor-test.png",
                "Content-Type": "image/png",
                Origin: BASE,
            },
            data: pngBytes,
        });
        expect(uploadRes.ok()).toBe(true);

        const listRes = await authApi1.get("/api/auth/files/list");
        const listBody = await listRes.json();
        const file = listBody.files?.find((f: { originalName: string }) => f.originalName === "idor-test.png");
        expect(file).toBeTruthy();

        // authApi2 (different user) attempts to delete authApi1's file
        const deleteRes = await authApi2.post("/api/auth/files/delete", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: { fileId: file.id },
        });
        expect(deleteRes.ok()).toBe(false);

        // Verify file still exists for authApi1
        const verifyRes = await authApi1.get("/api/auth/files/list");
        const verifyBody = await verifyRes.json();
        const stillExists = verifyBody.files?.find((f: { originalName: string }) => f.originalName === "idor-test.png");
        expect(stillExists).toBeTruthy();

        // Cleanup
        await authApi1.post("/api/auth/files/delete", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: { fileId: file.id },
        });
    });

    // ── Sign-Out Session Invalidation ──────────────────────────────────

    test("sign-out invalidates the session token server-side", async () => {
        const sessionApi = await pwRequest.newContext({ baseURL: BASE });
        await signInAnonymous(sessionApi);

        const beforeRes = await sessionApi.get("/api/auth/get-session");
        const beforeBody = await beforeRes.json().catch(() => null);
        expect(beforeBody?.session).toBeTruthy();

        const storageState = await sessionApi.storageState();
        const sessionCookie = storageState.cookies.find(
            c => c.name.includes("session") || c.name.includes("better-auth")
        );
        expect(sessionCookie).toBeTruthy();

        const signOutRes = await sessionApi.post("/api/auth/sign-out", {
            headers: { "Content-Type": "application/json", Origin: BASE },
            data: {},
        });
        expect(signOutRes.ok()).toBe(true);

        // Replay the old session token on a clean context
        const replayApi = await pwRequest.newContext({ baseURL: BASE });
        const replayRes = await replayApi.get("/api/auth/get-session", {
            headers: { Cookie: `${sessionCookie!.name}=${sessionCookie!.value}` },
        });
        const replayBody = await replayRes.json().catch(() => null);
        expect(replayBody?.session).toBeFalsy();

        await sessionApi.dispose();
        await replayApi.dispose();
    });

    // ── CORS Headers ─────────────────────────────────────────────────

    test("API does not reflect attacker origin in CORS with credentials", async () => {
        const res = await api.get("/api/auth/get-session", {
            headers: { Origin: "https://evil-attacker.com" },
        });
        const acao = res.headers()["access-control-allow-origin"] ?? "";
        const acac = res.headers()["access-control-allow-credentials"] ?? "";
        if (acac.toLowerCase() === "true") {
            expect(acao).not.toBe("https://evil-attacker.com");
        }
    });

    // ── File Upload Size Limit ───────────────────────────────────────

    test("file upload rejects files exceeding size limit", async () => {
        // R2 config allows max 2MB; send 3MB
        const oversizedData = Buffer.alloc(3 * 1024 * 1024, 0x89);
        const res = await authApi1.post("/api/auth/files/upload-raw", {
            headers: {
                "x-filename": "oversized.png",
                "Content-Type": "image/png",
                "Content-Length": String(oversizedData.length),
                Origin: BASE,
            },
            data: oversizedData,
        });
        expect(res.ok()).toBe(false);
    });

    // ── Rate Limiting (must be last — exhausts the rate window) ────────

    test("rate limiting is enforced on sign-in endpoint", async () => {
        const freshApi = await pwRequest.newContext({ baseURL: BASE });
        let hitRateLimit = false;

        for (let batch = 0; batch < 15 && !hitRateLimit; batch++) {
            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    freshApi.post("/api/auth/sign-in/email", {
                        headers: { "Content-Type": "application/json" },
                        data: { email: `pentest${batch * 10 + i}@example.com`, password: "test" },
                    })
                )
            );
            if (results.some(r => r.status() === 429)) {
                hitRateLimit = true;
            }
        }

        expect(hitRateLimit).toBe(true);
        await freshApi.dispose();
    });
});
