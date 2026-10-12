# Changelog

## Unreleased

### Changed

- `/cloudflare/geolocation` responds 401 when signed out and 404 when no `cf` context is available, instead of 200 with an `error` body. On the server, `auth.api.getGeolocation()` throws `APIError` ([#77](https://github.com/zpg6/better-auth-cloudflare/pull/77))

### Fixed

- R2 validation errors return 400, 413 or 415 and blocked upload hooks return 403, instead of 500 ([#77](https://github.com/zpg6/better-auth-cloudflare/pull/77))
- R2 downloads send the filename as RFC 5987 `filename*`, so a crafted name can no longer inject a second filename, and non-ASCII names round-trip instead of becoming `?`. Names with control characters are rejected with 400. Clients older than this release that send a name containing a valid `%XX` sequence have it stored decoded ([#76](https://github.com/zpg6/better-auth-cloudflare/pull/76))
- R2 uploads store the exact request bytes. Before, types the body parser didn't handle (csv, zip, mp3, markdown) were stored as the text `[object ReadableStream]`, and binary sent as text was re-encoded. Empty files upload. `allowedTypes` is enforced by file extension only, downloads send `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`, and the `mime` dependency is gone ([#78](https://github.com/zpg6/better-auth-cloudflare/pull/78))

## v0.4.0 (2026-10-11)

### Changed

- **BREAKING**: On Better Auth 1.7+, `withCloudflare({ kv })` now fails on the first request unless verification and rate limiting are routed away from KV. 0.3.1 failed silently instead: verification consumes threw, so magic links and OTPs returned 500 and 2FA users were locked out ([#72](https://github.com/zpg6/better-auth-cloudflare/issues/72)). Fix with `verification: { storeInDatabase: true }` and `rateLimit: { storage: "database" }` (or `memory`, `customStorage`, or `enabled: false`) ([#63](https://github.com/zpg6/better-auth-cloudflare/pull/63), [#69](https://github.com/zpg6/better-auth-cloudflare/pull/69))
- `createKVStorage()` now returns `CloudflareKVStorage` (`get`, `set`, `delete`) instead of `SecondaryStorage`
- Better Auth 1.7 validates Drizzle schemas (`advanced.database.validateSchema`, on by default) and fails writes with `SchemaMismatchError` until the schema matches, e.g. field maps that point at column names instead of Drizzle property keys. Regenerate `auth.schema.ts` after upgrading

### Added

- `cf` accepts a function, resolved per request, so one auth instance can serve many requests ([#70](https://github.com/zpg6/better-auth-cloudflare/pull/70))

### Fixed

- R2 uploads return the generated file id, and client metadata can no longer override system fields ([#44](https://github.com/zpg6/better-auth-cloudflare/pull/44) by @MagnumGoYB)
- Docs: KV secondary storage delays session revocation ([#62](https://github.com/zpg6/better-auth-cloudflare/pull/62) by @sns45)

### CLI v0.1.20

- Read `wrangler.jsonc` and `wrangler.json` as well as `wrangler.toml` ([#54](https://github.com/zpg6/better-auth-cloudflare/pull/54) by @mrhut10)
- Generated projects route verification and rate limiting for Better Auth 1.7 ([#69](https://github.com/zpg6/better-auth-cloudflare/pull/69))
- Fix generated Hyperdrive projects ([#68](https://github.com/zpg6/better-auth-cloudflare/pull/68))

## v0.3.1 (2026-07-23)

- Fix: support `@cloudflare/workers-types` v5 by widening the peer dependency to `>=4` ([#59](https://github.com/zpg6/better-auth-cloudflare/pull/59) by @mmcintosh)

## v0.3.0 (2026-04-05)

### Added

- **Native D1 support**: New `d1Native` option on `withCloudflare` accepts a `D1Database` binding directly — no Drizzle required.

### Changed

- **BREAKING**: Peer dependency `better-auth` minimum raised from `^1.1.21` to `^1.5.0`
- **BREAKING**: New peer dependency `@better-auth/drizzle-adapter` (`^1.5.0`) required when using Drizzle-based database options (`d1`, `postgres`, `mysql`)
- Bumped `zod` to `^4.3.0`, `drizzle-orm` to `^0.45.0`

### Fixed

- **Geolocation silently broken on v1.5+**: Session `create.before` hook returned the mutated object directly, which v1.5 interprets as `true` and discards mutations. Now returns `{ data: ... }` wrapper.
- Renamed `FieldAttribute` → `DBFieldAttribute` and `AuthPluginSchema` → `BetterAuthPluginDBSchema` to match upstream renames
- Migrated drizzle adapter imports from deprecated `better-auth/adapters/drizzle` to `@better-auth/drizzle-adapter`
- Removed `any` types from session hook and R2 hook parameters

## v0.2.9 (2025-12-06)

- Add troubleshooting instructions for `ERR_REQUIRE_ESM` ([#43](https://github.com/zpg6/better-auth-cloudflare/pull/43) by @traylollipop)
- Fix: pass `allowedMediaTypes` for R2 uploads to resolve 415 error ([#46](https://github.com/zpg6/better-auth-cloudflare/pull/46) by @vzt7)

## v0.2.8 (2025-10-27)

- Fix: KV TTL minimum 60 seconds enforcement ([#42](https://github.com/zpg6/better-auth-cloudflare/pull/42))

## v0.2.7 (2025-10-04)

- Fix: `FieldAttribute` type usage ([#37](https://github.com/zpg6/better-auth-cloudflare/pull/37))

## v0.2.6 (2025-09-27)

- Align build system with BetterAuth ([#26](https://github.com/zpg6/better-auth-cloudflare/pull/26))

## v0.2.5 (2025-09-20)

- Feat: continuous releases ([#22](https://github.com/zpg6/better-auth-cloudflare/pull/22))
- Feat: upgrade to Zod v4 and improve R2 file validation ([#21](https://github.com/zpg6/better-auth-cloudflare/pull/21) by @axuj)

## v0.2.4 (2025-08-15)

- Add `CloudflareSession` type for Session + geolocation fields
- OpenNextJS example middleware now uses `/api/auth/get-session` typed with `CloudflareSessionResponse`

## v0.2.3 (2025-08-12)

- Fix: `generateId` returns `string | false` as of better-auth@1.3.5 ([#13](https://github.com/zpg6/better-auth-cloudflare/pull/13))

## v0.2.2 (2025-07-26)

- Feat: Hyperdrive Postgres/MySQL support ([#9](https://github.com/zpg6/better-auth-cloudflare/pull/9))

## v0.2.0 (2025-06-15)

- Major feature release (R2 file storage, KV secondary storage, enhanced geolocation)

## v0.1.5 (2025-06-06)

- Fix: plugin inference using `withCloudflare` ([#5](https://github.com/zpg6/better-auth-cloudflare/pull/5))
- Feat: add `cf` context option for universal framework support ([#2](https://github.com/zpg6/better-auth-cloudflare/pull/2) by @imjlk)

## v0.1.4 (2025-06-06)

- Fix: update `withCloudflare` to support generic `BetterAuthOptions` ([#4](https://github.com/zpg6/better-auth-cloudflare/pull/4) by @WardLavrijsen)

## v0.1.3 (2025-05-26)

- Maintenance release

## v0.1.2 (2025-05-11)

- Initial release
