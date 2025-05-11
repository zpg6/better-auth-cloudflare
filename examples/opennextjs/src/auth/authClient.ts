import { createAuthClient } from "better-auth/react";
import { cloudflareClient } from "better-auth-cloudflare/client";

const client = createAuthClient({
    plugins: [cloudflareClient()],
});

export default client;
