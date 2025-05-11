"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import authClient from "@/auth/authClient";
import { useState } from "react";

export default function Home() {
    const { error: sessionError } = authClient.useSession();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [isAuthActionInProgress, setIsAuthActionInProgress] = useState(false);
    const [activeAuthAction, setActiveAuthAction] = useState<"signIn" | "signUp" | null>(null);

    const executeAuthAction = async (action: Promise<any>, actionType: "signIn" | "signUp") => {
        setIsAuthActionInProgress(true);
        setActiveAuthAction(actionType);
        try {
            await action;
        } catch (e: any) {
            setIsAuthActionInProgress(false);
            setActiveAuthAction(null);
            alert(`An unexpected error occurred during the auth action: ${e.message}`);
        }
    };

    const handleSignIn = async () => {
        if (!email || !password) {
            alert("Please enter email and password.");
            return;
        }
        await executeAuthAction(
            authClient.signIn
                .email({
                    email,
                    password,
                    callbackURL: "/dashboard",
                })
                .then(({ error: signInError }) => {
                    if (signInError) {
                        setIsAuthActionInProgress(false);
                        setActiveAuthAction(null);
                        alert(`Sign in failed: ${signInError.message}`);
                    }
                }),
            "signIn"
        );
    };

    const handleSignUp = async () => {
        if (!email || !password) {
            alert("Please enter email and password.");
            return;
        }
        await executeAuthAction(
            authClient.signUp
                .email({
                    email,
                    password,
                    name: email,
                    callbackURL: "/dashboard",
                })
                .then(({ error: signUpError }) => {
                    if (signUpError) {
                        alert(`Sign up failed: ${signUpError.message}`);
                    }
                }),
            "signUp"
        );
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
                    <CardDescription>
                        Powered by better-auth-cloudflare.
                        <br />
                        Enter your email below to login to your account.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="m@example.com"
                            required
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            disabled={isAuthActionInProgress}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            required
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            disabled={isAuthActionInProgress}
                        />
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                    <Button onClick={handleSignIn} className="w-full" disabled={isAuthActionInProgress}>
                        {isAuthActionInProgress && activeAuthAction === "signIn" ? "Signing In..." : "Sign In"}
                    </Button>
                    <Button
                        onClick={handleSignUp}
                        className="w-full"
                        variant="outline"
                        disabled={isAuthActionInProgress}
                    >
                        {isAuthActionInProgress && activeAuthAction === "signUp" ? "Signing Up..." : "Sign Up"}
                    </Button>
                </CardFooter>
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
