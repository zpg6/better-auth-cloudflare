import { cloudflareClient } from "better-auth-cloudflare/client";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const client = createAuthClient({
    plugins: [cloudflareClient(), anonymousClient()],
});

export default client;
