import { test, expect } from "@playwright/test";

const BASE = "https://better-auth-cloudflare.com";

test.describe("Custom Domain (better-auth-cloudflare.com)", () => {
    // Validates that the custom domain routes to the same OpenNextJS deployment
    // and that CSRF / origin validation works correctly across both domains.

    test("landing page loads on custom domain", async ({ page }) => {
        await page.goto(BASE, { waitUntil: "networkidle" });
        await expect(page.getByText("Login", { exact: true })).toBeVisible();
        await expect(page.getByText("Powered by better-auth-cloudflare", { exact: true }).first()).toBeVisible();
    });

    test("anonymous sign-in works on custom domain (CSRF origin check)", async ({ page }) => {
        const res = await page.request.post(`${BASE}/api/auth/sign-in/anonymous`, {
            headers: { "Content-Type": "application/json" },
            data: {},
        });
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.user).toBeTruthy();
        expect(body.user.id).toBeTruthy();
    });

    test("session API works on custom domain", async ({ page }) => {
        await page.request.post(`${BASE}/api/auth/sign-in/anonymous`, {
            headers: { "Content-Type": "application/json" },
            data: {},
        });

        const res = await page.request.get(`${BASE}/api/auth/get-session`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.session).toBeTruthy();
        expect(body.user).toBeTruthy();
    });

    test("geolocation API works on custom domain", async ({ page }) => {
        await page.request.post(`${BASE}/api/auth/sign-in/anonymous`, {
            headers: { "Content-Type": "application/json" },
            data: {},
        });

        const res = await page.request.get(`${BASE}/api/auth/cloudflare/geolocation`);
        expect(res.ok()).toBe(true);
        const body = await res.json();
        expect(body.timezone).toBeTruthy();
        expect(body.colo).toBeTruthy();
    });

    test("full login flow works on custom domain", async ({ page }) => {
        await page.goto(BASE, { waitUntil: "networkidle" });

        if (page.url().includes("/dashboard")) {
            await expect(page.locator("text=Dashboard")).toBeVisible();
            return;
        }

        await page.getByRole("button", { name: "Login Anonymously" }).click();
        // The OpenNextJS app does window.location.reload() after sign-in, then middleware redirects
        await expect(page.locator("text=Dashboard")).toBeVisible({ timeout: 30_000 });
        expect(page.url()).toContain("/dashboard");
    });
});
