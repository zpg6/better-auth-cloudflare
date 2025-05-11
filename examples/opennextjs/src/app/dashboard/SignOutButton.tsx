"use client";

import { Button } from "@/components/ui/button"; // Import the shadcn/ui Button
import authClient from "@/auth/authClient"; // Assuming default export from your authClient setup
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react"; // Added useState and useTransition

export default function SignOutButton() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition(); // For smoother UI updates

    const handleSignOut = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await authClient.signOut({
                fetchOptions: {
                    onSuccess: () => {
                        startTransition(() => {
                            router.replace("/"); // Redirect to home page on sign out
                        });
                    },
                    onError: err => {
                        console.error("Sign out error:", err);
                        setError(err.error.message || "Sign out failed. Please try again.");
                        // Optionally, still attempt to redirect or handle UI differently
                        // router.replace("/");
                    },
                },
            });
        } catch (e: any) {
            // Catch any unexpected errors during the signOut call itself
            console.error("Unexpected sign out error:", e);
            setError(e.message || "An unexpected error occurred. Please try again.");
            // router.replace("/"); // Fallback redirect
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="w-full mt-6">
            {" "}
            {/* Container for button and error message */}
            <Button
                onClick={handleSignOut}
                disabled={isLoading || isPending}
                variant="destructive" // Use destructive variant for sign out
                className="w-full"
            >
                {isLoading || isPending ? "Signing Out..." : "Sign Out"}
            </Button>
            {error && <p className="text-red-500 text-sm text-center mt-2">{error}</p>}
        </div>
    );
}
