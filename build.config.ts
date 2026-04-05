import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
    rollup: {
        emitCJS: true,
        esbuild: {
            treeShaking: true,
        },
    },
    declaration: true,
    outDir: "dist",
    clean: true,
    failOnWarn: false,
    externals: [
        "better-auth",
        "@better-auth/drizzle-adapter",
        "drizzle-orm",
        "zod",
        "@cloudflare/workers-types",
        "mime",
    ],
    entries: ["./src/index.ts", "./src/client.ts", "./src/r2.ts", "./src/schema.ts", "./src/types.ts"],
});
