import type { CloudflareSessionResponse } from "better-auth-cloudflare";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Routes that require authentication
    const protectedRoutes = ["/dashboard"];
    // Routes that should redirect to dashboard if already authenticated
    const authRoutes = ["/", "/sign-in"];

    const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
    const isAuthRoute = authRoutes.includes(pathname);

    // Only check session for routes that need auth logic
    if (isProtectedRoute || isAuthRoute) {
        try {
            // Use the auth API route instead of importing better-auth directly
            // This avoids Edge Runtime dynamic code evaluation issues with @opennextjs/cloudflare
            const sessionResponse = await fetch(new URL("/api/auth/get-session", request.url), {
                method: "GET",
                headers: {
                    cookie: request.headers.get("cookie") || "",
                },
            });

            const isAuthenticated = sessionResponse.ok;
            let sessionData: CloudflareSessionResponse | null = null;

            if (isAuthenticated) {
                try {
                    sessionData = await sessionResponse.json();
                    // Double-check that we have a valid session
                    if (!sessionData?.session || !sessionData.session.userId) {
                        sessionData = null;
                    }
                } catch {
                    sessionData = null;
                }
            }

            // Handle protected routes - redirect to home if not authenticated
            if (isProtectedRoute && !sessionData) {
                const url = request.nextUrl.clone();
                url.pathname = "/";
                return NextResponse.redirect(url);
            }

            // Handle auth routes - redirect to dashboard if already authenticated
            if (isAuthRoute && sessionData) {
                const url = request.nextUrl.clone();
                url.pathname = "/dashboard";
                return NextResponse.redirect(url);
            }

            // Optional: Log geolocation data for authenticated users
            if (sessionData) {
                console.log("Authenticated request from:", {
                    country: sessionData.session.country,
                    city: sessionData.session.city,
                    timezone: sessionData.session.timezone,
                });
            }
        } catch (error) {
            console.error("Middleware error:", error);

            // On error, only redirect protected routes to avoid redirect loops
            if (isProtectedRoute) {
                const url = request.nextUrl.clone();
                url.pathname = "/";
                return NextResponse.redirect(url);
            }
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/dashboard/:path*", // Protects /dashboard and all its sub-routes
        "/", // Home page - redirect to dashboard if authenticated
        "/sign-in", // Sign-in page - redirect to dashboard if authenticated
    ],
};
