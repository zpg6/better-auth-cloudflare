# Changelog

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
