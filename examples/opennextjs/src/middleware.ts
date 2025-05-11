import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { initAuth } from "@/auth"; // Adjust if your auth init is elsewhere

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Protect the /dashboard route
    if (pathname.startsWith("/dashboard")) {
        try {
            const authInstance = await initAuth();
            const session = await authInstance.api.getSession({ headers: request.headers });

            if (!session) {
                // User is not authenticated, redirect to home page
                const url = request.nextUrl.clone();
                url.pathname = "/";
                return NextResponse.redirect(url);
            }
        } catch (error) {
            console.error("Middleware error:", error);
            // Optional: redirect to an error page or home on error
            const url = request.nextUrl.clone();
            url.pathname = "/"; // Or an error page like '/auth-error'
            return NextResponse.redirect(url);
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        "/dashboard/:path*", // Protects /dashboard and all its sub-routes
    ],
};
