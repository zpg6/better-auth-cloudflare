import { cloudflareClient } from "better-auth-cloudflare/client";
import { anonymousClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const client = createAuthClient({
    plugins: [cloudflareClient(), anonymousClient(), organizationClient()],
});

export default client;
