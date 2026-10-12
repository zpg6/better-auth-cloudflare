import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { magicLink, organization, twoFactor } from "better-auth/plugins";
import { cloudflareClient, createKVStorage, withCloudflare, type CloudflareSession } from "../../src";

// Global Workers types alongside the DOM lib, as in this repo's tsconfig.
declare const env: { KV: KVNamespace; R2: R2Bucket; DB: D1Database };

createKVStorage(env.KV);
// @ts-expect-error bindings are typed, not any
createKVStorage(123);

const plugins = [organization(), twoFactor(), magicLink({ sendMagicLink: async () => {} })];
const auth = betterAuth(withCloudflare({ d1Native: env.DB, kv: env.KV, r2: { bucket: env.R2 }, cf: {} }, { plugins }));
const authWithoutR2 = betterAuth(withCloudflare({ d1Native: env.DB, cf: {} }, { plugins }));

auth.api.upload satisfies Function;
auth.api.getGeolocation satisfies Function;
auth.api.createOrganization satisfies Function;
auth.api.enableTwoFactor satisfies Function;
auth.api.signInMagicLink satisfies Function;
// @ts-expect-error R2 routes exist only when r2 is configured
authWithoutR2.api.upload;

auth.$Infer.Session.session satisfies CloudflareSession;
auth.$Infer.Session.session.country satisfies string | null | undefined;

const client = createAuthClient({ plugins: [cloudflareClient()] });
client.$Infer.Session.session.country satisfies string | null | undefined;
