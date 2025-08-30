"use client";

import authClient from "@/auth/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Github, Package } from "lucide-react";
import { useState } from "react";

export default function Home() {
    const { data: session, error: sessionError } = authClient.useSession();
    const [isAuthActionInProgress, setIsAuthActionInProgress] = useState(false);

    const handleAnonymousLogin = async () => {
        setIsAuthActionInProgress(true);
        try {
            const result = await authClient.signIn.anonymous();
            console.log("Anonymous login result:", result);

            if (result.error) {
                setIsAuthActionInProgress(false);
                alert(`Anonymous login failed: ${result.error.message}`);
            } else {
                // Login succeeded - middleware will handle redirect to dashboard
                // Force a page refresh to trigger middleware redirect
                window.location.reload();
            }
        } catch (e: any) {
            setIsAuthActionInProgress(false);
            alert(`An unexpected error occurred during login: ${e.message}`);
        }
    };

    if (sessionError) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <p>Error loading session: {sessionError.message}</p>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">Login</CardTitle>
                    <CardDescription>Powered by better-auth-cloudflare.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <p className="text-sm text-gray-600 text-center">No personal information required.</p>
                </CardContent>
                <CardFooter>
                    <Button onClick={handleAnonymousLogin} className="w-full" disabled={isAuthActionInProgress}>
                        {isAuthActionInProgress ? "Logging In..." : "Login Anonymously"}
                    </Button>
                </CardFooter>
            </Card>
            <footer className="absolute bottom-0 w-full text-center text-sm text-gray-500 py-4">
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
                    </div>
                </div>
            </footer>
        </div>
    );
}
