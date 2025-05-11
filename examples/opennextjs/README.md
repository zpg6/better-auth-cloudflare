# `better-auth-cloudflare` Example: Next.js on Cloudflare Workers

This example demonstrates how to use [`better-auth-cloudflare`](https://github.com/better-auth/better-auth), our authentication package specifically designed for Cloudflare, with a Next.js application deployed to [Cloudflare Workers](https://workers.cloudflare.com/) using the [OpenNext Cloudflare adapter](https://github.com/opennextjs/opennextjs-cloudflare).

## About `better-auth-cloudflare`

`better-auth-cloudflare` provides seamless authentication capabilities for applications deployed to Cloudflare's serverless platform. This package handles:

- User authentication and session management
- Integrating with Cloudflare's D1 database
- Support for the App Router architecture in Next.js
- Schema generation with Drizzle ORM

This example project showcases a complete implementation of our authentication solution in a real-world Next.js application.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the authentication features in action.

## Authentication Scripts

Our package provides several scripts to help manage authentication:

- `pnpm auth:generate`: Generates the Drizzle schema for Better Auth based on your configuration in `src/auth/index.ts`. The output is saved to `src/db/auth.schema.ts`.
- `pnpm auth:format`: Formats the generated `auth.schema.ts` file using Prettier.
- `pnpm auth:update`: A convenience script that runs both `auth:generate` and `auth:format` in sequence.

## Database Management

The example configures `better-auth-cloudflare` to work with Cloudflare's D1 database:

- `pnpm db:generate`: Generates SQL migration files based on changes in your Drizzle schema (defined in `src/db/schema.ts` and the generated `src/db/auth.schema.ts`).
- `pnpm db:migrate:dev`: Applies pending migrations to your local D1 database.
- `pnpm db:migrate:prod`: Applies pending migrations to your remote/production D1 database.
- `pnpm db:studio:dev`: Starts Drizzle Studio, a local GUI for browsing your local D1 database.
- `pnpm db:studio:prod`: Starts Drizzle Studio for your remote/production D1 database.

## Deployment Scripts

Deploy your Next.js application with Better Auth to Cloudflare:

- `pnpm build:cf`: Builds the application specifically for Cloudflare Workers using OpenNext.
- `pnpm deploy`: Builds the application for Cloudflare and deploys it.
- `pnpm preview`: Builds the application for Cloudflare and allows you to preview it locally before deploying.

## Additional Scripts

- `pnpm build`: Creates an optimized production build of your Next.js application.
- `pnpm clean`: Removes build artifacts, cached files, and `node_modules`.
- `pnpm clean-deploy`: Cleans the project, reinstalls dependencies, and then deploys.
- `pnpm format`: Formats all project files using Prettier.
- `pnpm lint`: Lints the project using Next.js's built-in ESLint configuration.

## Learn More

To learn more about Better Auth and its features, visit [our documentation](https://github.com/better-auth/better-auth).

For Next.js resources:

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
