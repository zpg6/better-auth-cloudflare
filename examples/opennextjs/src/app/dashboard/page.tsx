import { initAuth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SignOutButton from "./SignOutButton"; // Import the client component

export default async function DashboardPage() {
    const authInstance = await initAuth();
    // Fetch session using next/headers per better-auth docs for server components
    const session = await authInstance.api.getSession({ headers: await headers() });

    if (!session) {
        redirect("/"); // Redirect to home if no session
    }

    // Access Cloudflare data from session.session?.cloudflare or session.session?.geo
    const cloudflareGeolocationData = await authInstance.api.getGeolocation({ headers: await headers() });

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-3xl font-bold text-center">Dashboard</CardTitle>
                    <p className="text-sm text-center text-gray-500">Powered by better-auth-cloudflare</p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-lg">
                        Welcome,{" "}
                        <span className="font-semibold">{session.user?.name || session.user?.email || "User"}</span>!
                    </p>
                    {session.user?.email && (
                        <p className="text-md">
                            <strong>Email:</strong> {session.user.email}
                        </p>
                    )}
                    {session.user?.id && (
                        <p className="text-md">
                            <strong>User ID:</strong> {session.user.id}
                        </p>
                    )}
                    {cloudflareGeolocationData && "error" in cloudflareGeolocationData && (
                        <p className="text-md">
                            <strong>Error:</strong> {cloudflareGeolocationData.error}
                        </p>
                    )}
                    {cloudflareGeolocationData && !("error" in cloudflareGeolocationData) && (
                        <>
                            <p className="text-md">
                                <strong>Timezone:</strong> {cloudflareGeolocationData.timezone || "Unknown"}
                            </p>
                            <p className="text-md">
                                <strong>City:</strong> {cloudflareGeolocationData.city || "Unknown"}
                            </p>
                            <p className="text-md">
                                <strong>Country:</strong> {cloudflareGeolocationData.country || "Unknown"}
                            </p>
                            <p className="text-md">
                                <strong>Region:</strong> {cloudflareGeolocationData.region || "Unknown"}
                            </p>
                            <p className="text-md">
                                <strong>Region Code:</strong> {cloudflareGeolocationData.regionCode || "Unknown"}
                            </p>
                            <p className="text-md">
                                <strong>Data Center:</strong> {cloudflareGeolocationData.colo || "Unknown"}
                            </p>
                            {cloudflareGeolocationData.latitude && (
                                <p className="text-md">
                                    <strong>Latitude:</strong> {cloudflareGeolocationData.latitude || "Unknown"}
                                </p>
                            )}
                            {cloudflareGeolocationData.longitude && (
                                <p className="text-md">
                                    <strong>Longitude:</strong> {cloudflareGeolocationData.longitude || "Unknown"}
                                </p>
                            )}
                        </>
                    )}
                    <SignOutButton /> {/* Use the client component for sign out */}
                </CardContent>
            </Card>
            <footer className="absolute bottom-0 w-full text-center text-sm text-gray-500 py-4">
                Powered by{" "}
                <a
                    href="https://github.com/zpg6/better-auth-cloudflare"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                >
                    better-auth-cloudflare
                </a>
                {" | "}
                <a
                    href="https://www.npmjs.com/package/better-auth-cloudflare"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                >
                    npm package
                </a>
            </footer>
        </div>
    );
}
