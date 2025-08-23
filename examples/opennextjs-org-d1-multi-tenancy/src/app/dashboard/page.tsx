import { initAuth } from "@/auth";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import SignOutButton from "./SignOutButton"; // Import the client component
import FileUploadDemo from "@/components/FileUploadDemo";
import { Github, Package, FileText, MapPin, Clock, Globe, Building, Server, Navigation } from "lucide-react";

export default async function DashboardPage() {
    const authInstance = await initAuth();
    // Fetch session using next/headers per better-auth docs for server components
    const session = await authInstance.api.getSession({ headers: await headers() });

    if (!session) {
        redirect("/"); // Redirect to home if no session
    }

    // Get geolocation data from our plugin's endpoint
    const cloudflareGeolocationData = await authInstance.api.getGeolocation({ headers: await headers() });

    // Access another plugin's endpoint to demonstrate plugin type inference is still intact
    const openAPISpec = await authInstance.api.generateOpenAPISchema();

    return (
        <div className="flex flex-col min-h-screen font-[family-name:var(--font-geist-sans)]">
            <main className="flex-1 flex flex-col items-center justify-center p-8">
                <div className="w-full max-w-3xl">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold">Dashboard</h1>
                        <p className="text-sm text-gray-500 mt-2">Powered by better-auth-cloudflare</p>
                    </div>

                    <Tabs defaultValue="user" className="w-full">
                        <TabsList className="grid w-full grid-cols-3 mb-6">
                            <TabsTrigger value="user">User Info</TabsTrigger>
                            <TabsTrigger value="geolocation">Geolocation</TabsTrigger>
                            <TabsTrigger value="upload">File Upload</TabsTrigger>
                        </TabsList>

                        <TabsContent value="user" className="space-y-6">
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="text-xl font-semibold">User Information</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <p className="text-lg">
                                        Welcome,{" "}
                                        <span className="font-semibold">
                                            {session.user?.name || session.user?.email || "Anonymous User"}
                                        </span>
                                        !
                                    </p>
                                    {session.user?.email && (
                                        <p className="text-md break-words">
                                            <strong>Email:</strong>{" "}
                                            <span className="break-all">{session.user.email}</span>
                                        </p>
                                    )}
                                    {!session.user?.email && (
                                        <p className="text-md">
                                            <strong>Account Type:</strong> Anonymous
                                        </p>
                                    )}
                                    {session.user?.id && (
                                        <p className="text-md">
                                            <strong>User ID:</strong> {session.user.id}
                                        </p>
                                    )}
                                    <SignOutButton /> {/* Use the client component for sign out */}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="geolocation" className="space-y-6">
                            <Card className="w-full">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-xl font-semibold">
                                        <MapPin className="h-5 w-5" />
                                        Your Location
                                    </CardTitle>
                                    <p className="text-sm text-gray-600">
                                        Automatically detected using Cloudflare's global network
                                    </p>
                                </CardHeader>
                                <CardContent>
                                    {cloudflareGeolocationData && "error" in cloudflareGeolocationData && (
                                        <div className="flex items-center gap-2 p-4 bg-red-50 rounded-lg">
                                            <div className="text-red-500">⚠️</div>
                                            <p className="text-red-700">
                                                <strong>Error:</strong> {cloudflareGeolocationData.error}
                                            </p>
                                        </div>
                                    )}
                                    {cloudflareGeolocationData && !("error" in cloudflareGeolocationData) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="flex items-center gap-3 p-2">
                                                <Clock className="h-5 w-5 text-gray-600" />
                                                <div>
                                                    <p className="font-medium text-gray-900">Timezone</p>
                                                    <p className="text-gray-600">
                                                        {cloudflareGeolocationData.timezone || "Unknown"}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 p-2">
                                                <Building className="h-5 w-5 text-gray-600" />
                                                <div>
                                                    <p className="font-medium text-gray-900">City</p>
                                                    <p className="text-gray-600">
                                                        {cloudflareGeolocationData.city || "Unknown"}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 p-2">
                                                <Globe className="h-5 w-5 text-gray-600" />
                                                <div>
                                                    <p className="font-medium text-gray-900">Country</p>
                                                    <p className="text-gray-600">
                                                        {cloudflareGeolocationData.country || "Unknown"}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 p-2">
                                                <MapPin className="h-5 w-5 text-gray-600" />
                                                <div>
                                                    <p className="font-medium text-gray-900">Region</p>
                                                    <p className="text-gray-600">
                                                        {cloudflareGeolocationData.region || "Unknown"}
                                                        {cloudflareGeolocationData.regionCode &&
                                                            ` (${cloudflareGeolocationData.regionCode})`}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 p-2">
                                                <Server className="h-5 w-5 text-gray-600" />
                                                <div>
                                                    <p className="font-medium text-gray-900">Data Center</p>
                                                    <p className="text-gray-600">
                                                        {cloudflareGeolocationData.colo || "Unknown"}
                                                    </p>
                                                </div>
                                            </div>

                                            {(cloudflareGeolocationData.latitude ||
                                                cloudflareGeolocationData.longitude) && (
                                                <div className="flex items-center gap-3 p-2">
                                                    <Navigation className="h-5 w-5 text-gray-600" />
                                                    <div>
                                                        <p className="font-medium text-gray-900">Coordinates</p>
                                                        <p className="text-gray-600">
                                                            {cloudflareGeolocationData.latitude &&
                                                            cloudflareGeolocationData.longitude
                                                                ? `${cloudflareGeolocationData.latitude}, ${cloudflareGeolocationData.longitude}`
                                                                : "Partially available"}
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="upload" className="space-y-6">
                            <FileUploadDemo />
                        </TabsContent>
                    </Tabs>
                </div>
            </main>

            <footer className="w-full text-center text-sm text-gray-500 py-4 mt-8">
                <div className="space-y-3">
                    <div>Powered by better-auth-cloudflare</div>
                    <div className="flex items-center justify-center gap-4">
                        <a
                            href="https://github.com/zpg6/better-auth-cloudflare"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                        >
                            <Github size={16} />
                            <span>GitHub</span>
                        </a>
                        <a
                            href="https://www.npmjs.com/package/better-auth-cloudflare"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                        >
                            <Package size={16} />
                            <span>npm</span>
                        </a>
                        <Link
                            href="/api/auth/reference#tag/cloudflare/get/cloudflare/geolocation"
                            className="flex items-center gap-1 hover:text-gray-700 transition-colors"
                            title={`OpenAPI v${openAPISpec.openapi} Schema`}
                        >
                            <FileText size={16} />
                            <span>OpenAPI</span>
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
