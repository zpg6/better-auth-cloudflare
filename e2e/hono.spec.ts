import {
    test,
    expect,
    request as pwRequest,
    type Page,
    type APIRequestContext,
    type APIResponse,
} from "@playwright/test";

const BASE = "https://better-auth-cloudflare-hono.zpg6.workers.dev";

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

test.describe("Hono Live Site", () => {
    test.describe.configure({ mode: "serial" });

    let page: Page;

    test.beforeAll(async ({ browser }) => {
        const ctx = await browser.newContext();
        page = await ctx.newPage();
    });

    test.afterAll(async () => {
        await page.context().close();
    });

    // ── Health check ───────────────────────────────────────────────────
    test("GET /health returns ok", async () => {
        const res = await page.request.get(`${BASE}/health`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.status).toBe("ok");
        expect(body.timestamp).toBeTruthy();
    });

    // ── Home page loads ────────────────────────────────────────────────
    test("home page loads and shows login button", async () => {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await expect(page.locator("text=Dashboard - Hono")).toBeVisible();
        await expect(page.locator(".subtitle")).toContainText("better-auth-cloudflare");
        await expect(page.locator("text=Login Anonymously")).toBeVisible();
        await expect(page.locator("#status")).toContainText("Not Logged In");
    });

    // ── Browser-based anonymous login flow ─────────────────────────────
    test("clicking Login Anonymously shows session info", async () => {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await page.locator("text=Login Anonymously").click();
        await expect(page.locator("#status")).toContainText("Logged In", { timeout: 15_000 });
        await expect(page.locator("#user-name")).not.toBeEmpty();
        await expect(page.locator("#user-info")).toContainText("User ID:");
    });

    // ── Geolocation data visible after login ───────────────────────────
    test("geolocation data is displayed after login", async () => {
        await expect(page.locator("#geolocation-info")).not.toBeEmpty({ timeout: 10_000 });
        const geoText = await page.locator("#geolocation-info").textContent();
        expect(geoText).toContain("Timezone:");
    });

    // ── GET /api/auth/get-session returns session ──────────────────────
    test("GET /api/auth/get-session returns session data", async () => {
        const res = await page.request.get(`${BASE}/api/auth/get-session`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.session).toBeTruthy();
        expect(body.user).toBeTruthy();
        expect(body.session.id).toBeTruthy();
    });

    // ── Geolocation API ────────────────────────────────────────────────
    test("GET /api/auth/cloudflare/geolocation returns location", async () => {
        const res = await page.request.get(`${BASE}/api/auth/cloudflare/geolocation`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.timezone).toBeTruthy();
        expect(body.colo).toBeTruthy();
    });

    // ── Protected route (authenticated) ────────────────────────────────
    test("GET /protected returns content when authenticated", async () => {
        const res = await page.request.get(`${BASE}/protected`);
        expect(res.ok()).toBe(true);
        const html = await res.text();
        expect(html).toContain("Protected Content");
        expect(html).toContain("User ID:");
        expect(html).toContain("Session ID:");
    });

    // ── Try Protected Route button works ───────────────────────────────
    test("Try Protected Route button displays protected content", async () => {
        await page.locator("text=Try Protected Route").click();
        await expect(page.locator("#protected-result")).toContainText("Protected Content", { timeout: 10_000 });
    });

    // ── Sign out ───────────────────────────────────────────────────────
    test("clicking Logout returns to not-logged-in state", async () => {
        await page.locator("button:has-text('Logout')").click();
        await expect(page.locator("#status")).toContainText("Not Logged In", { timeout: 10_000 });
        await expect(page.locator("text=Login Anonymously")).toBeVisible();
    });

    // ── Protected route (unauthenticated) ──────────────────────────────
    test("GET /protected returns 401 when not authenticated", async () => {
        const freshCtx = await page.context().browser()!.newContext();
        const freshPage = await freshCtx.newPage();
        const res = await freshPage.request.get(`${BASE}/protected`);
        expect(res.status()).toBe(401);
        const html = await res.text();
        expect(html).toContain("Access Denied");
        await freshCtx.close();
    });
});

// ════════════════════════════════════════════════════════════════════════
// Penetration Tests — Hono
// ════════════════════════════════════════════════════════════════════════

test.describe("Hono Pen Tests", () => {
    let api: APIRequestContext;
    let authApi: APIRequestContext;
    let signInHeaders: { name: string; value: string }[];

    test.beforeAll(async () => {
        api = await pwRequest.newContext({ baseURL: BASE });
        authApi = await pwRequest.newContext({ baseURL: BASE });
        const signInRes = await signInAnonymous(authApi);
        signInHeaders = await signInRes.headersArray();
    });

    test.afterAll(async () => {
        await api.dispose();
        await authApi.dispose();
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
        // Should return null/empty session, not a valid session
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
        // Must not return a valid session for an injected token
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
        // Playwright (and modern HTTP stacks) reject CRLF in header values at the client level
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
        expect(text).not.toContain("Error:");
        expect(text).not.toMatch(/\/Users\/|\/home\/|C:\\/);
    });

    test("404 response does not reveal server framework version", async () => {
        const res = await api.get("/this-path-does-not-exist-xyz");
        const serverHeader = res.headers()["server"] ?? "";
        expect(serverHeader).not.toMatch(/hono\/\d/i);
        const poweredBy = res.headers()["x-powered-by"] ?? "";
        expect(poweredBy).toBe("");
    });

    // ── Oversized Payload ──────────────────────────────────────────────

    test("rejects excessively large JSON body", async () => {
        const largePayload = "A".repeat(10 * 1024 * 1024); // 10 MB
        const res = await api.post("/api/auth/sign-in/email", {
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ email: "test@example.com", password: "x", padding: largePayload }),
        });
        // Server must not crash; should reject or handle gracefully
        expect(res.status()).not.toBe(500);
        // The large payload should not have authenticated anyone
        expect(res.status()).not.toBe(200);
    });

    // ── Auth Bypass via Direct Access ──────────────────────────────────

    test("cannot access protected route with X-Forwarded-For spoofing", async () => {
        const res = await api.get("/protected", {
            headers: {
                "X-Forwarded-For": "127.0.0.1",
                "X-Real-IP": "127.0.0.1",
            },
        });
        expect(res.status()).toBe(401);
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
        // The unauthenticated `api` context should still have no session
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

        const sessionRes = await authApi.get("/api/auth/get-session");
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

    // ── Sign-Out Session Invalidation ──────────────────────────────────

    test("sign-out invalidates the session token server-side", async () => {
        const sessionApi = await pwRequest.newContext({ baseURL: BASE });
        await signInAnonymous(sessionApi);

        // Verify session works
        const beforeRes = await sessionApi.get("/api/auth/get-session");
        const beforeBody = await beforeRes.json().catch(() => null);
        expect(beforeBody?.session).toBeTruthy();

        // Extract the session cookie value
        const storageState = await sessionApi.storageState();
        const sessionCookie = storageState.cookies.find(
            c => c.name.includes("session") || c.name.includes("better-auth")
        );
        expect(sessionCookie).toBeTruthy();

        // Sign out
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
        // The critical vulnerability: reflecting the attacker's origin with credentials
        // allows cross-origin cookie-authenticated requests from any site
        if (acac.toLowerCase() === "true") {
            expect(acao).not.toBe("https://evil-attacker.com");
        }
    });

    // ── Rate Limiting ──────────────────────────────────────────────────

    test("rate limiting is enforced on sign-in endpoint", async () => {
        test.setTimeout(180_000);
        const freshApi = await pwRequest.newContext({ baseURL: BASE });
        let hitRateLimit = false;

        for (let batch = 0; batch < 30 && !hitRateLimit; batch++) {
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
