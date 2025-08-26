import { cloudflareClient } from "better-auth-cloudflare/client";
import { anonymousClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { birthdayClient } from "./plugins/birthday-client";

const client = createAuthClient({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    plugins: [cloudflareClient(), anonymousClient(), organizationClient(), birthdayClient()],
});

export default client;
