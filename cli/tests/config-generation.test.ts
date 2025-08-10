import { describe, expect, test } from "bun:test";

// Mock configuration generation functions
interface GenerateAnswers {
    appName: string;
    template: "hono" | "nextjs";
    database: "d1" | "hyperdrive-postgres" | "hyperdrive-mysql";
    d1Name?: string;
    d1Binding?: string;
    hdBinding?: string;
    hdName?: string;
    hdConnectionString?: string;
    geolocation: boolean;
    kv: boolean;
    kvBinding?: string;
    kvNamespaceName?: string;
    r2: boolean;
    r2Binding?: string;
    r2BucketName?: string;
}

function generateProjectConfig(answers: GenerateAnswers) {
    return {
        name: answers.appName,
        template: answers.template,
        database: {
            type: answers.database,
            ...(answers.database === "d1" && {
                d1Name: answers.d1Name,
                d1Binding: answers.d1Binding,
            }),
            ...(answers.database.startsWith("hyperdrive") && {
                hdBinding: answers.hdBinding,
                hdName: answers.hdName,
                hdConnectionString: answers.hdConnectionString,
            }),
        },
        features: {
            geolocation: answers.geolocation,
            kv: answers.kv
                ? {
                      binding: answers.kvBinding,
                      namespaceName: answers.kvNamespaceName,
                  }
                : false,
            r2: answers.r2
                ? {
                      binding: answers.r2Binding,
                      bucketName: answers.r2BucketName,
                  }
                : false,
        },
        createdAt: new Date().toISOString(),
    };
}

function generateWranglerCommands(answers: GenerateAnswers): string[] {
    const commands: string[] = [];

    if (answers.database === "d1" && answers.d1Name) {
        commands.push(`wrangler d1 create ${answers.d1Name}`);
    }

    if (answers.database.startsWith("hyperdrive") && answers.hdName && answers.hdConnectionString) {
        commands.push(
            `wrangler hyperdrive create ${answers.hdName} --connection-string="${answers.hdConnectionString}"`
        );
    }

    if (answers.kv && answers.kvNamespaceName) {
        commands.push(`wrangler kv:namespace create "${answers.kvNamespaceName}"`);
    }

    if (answers.r2 && answers.r2BucketName) {
        commands.push(`wrangler r2 bucket create ${answers.r2BucketName}`);
    }

    return commands;
}

function generateInstallCommands(answers: GenerateAnswers, packageManager: string): string[] {
    const commands: string[] = [];
    const installCmd = packageManager === "npm" ? "npm install" : `${packageManager} add`;

    // Base install
    commands.push(packageManager === "npm" ? "npm install" : `${packageManager} install`);

    // Database-specific dependencies
    if (answers.database === "hyperdrive-postgres") {
        commands.push(`${installCmd} postgres`);
    } else if (answers.database === "hyperdrive-mysql") {
        commands.push(`${installCmd} mysql2`);
    }

    return commands;
}

function generateScriptCommands(answers: GenerateAnswers, packageManager: string): string[] {
    const runCmd = packageManager === "npm" ? "npm run" : `${packageManager} run`;
    const commands: string[] = [];

    // Always generate auth and db commands
    commands.push(`${runCmd} auth:update`);
    commands.push(`${runCmd} db:generate`);

    // Migration commands depend on database type
    if (answers.database === "d1") {
        commands.push(`${runCmd} db:migrate:dev`);
        commands.push(`${runCmd} db:migrate:prod`);
    } else {
        commands.push(`${runCmd} db:push`); // Hyperdrive typically uses push instead of migrate
    }

    return commands;
}

describe("Configuration generation", () => {
    test("generates D1 project config", () => {
        const answers: GenerateAnswers = {
            appName: "my-d1-app",
            template: "hono",
            database: "d1",
            d1Name: "my-d1-db",
            d1Binding: "DATABASE",
            geolocation: true,
            kv: true,
            kvBinding: "KV_SESSIONS",
            kvNamespaceName: "my-app-sessions",
            r2: false,
        };

        const config = generateProjectConfig(answers);

        expect(config.name).toBe("my-d1-app");
        expect(config.template).toBe("hono");
        expect(config.database.type).toBe("d1");
        expect(config.database.d1Name).toBe("my-d1-db");
        expect(config.database.d1Binding).toBe("DATABASE");
        expect(config.features.geolocation).toBe(true);
        expect(config.features.kv).toEqual({
            binding: "KV_SESSIONS",
            namespaceName: "my-app-sessions",
        });
        expect(config.features.r2).toBe(false);
    });

    test("generates Hyperdrive Postgres project config", () => {
        const answers: GenerateAnswers = {
            appName: "my-postgres-app",
            template: "nextjs",
            database: "hyperdrive-postgres",
            hdBinding: "HYPERDRIVE",
            hdName: "my-postgres-hd",
            hdConnectionString: "postgres://user:pass@host:5432/db",
            geolocation: false,
            kv: false,
            r2: true,
            r2Binding: "FILE_STORAGE",
            r2BucketName: "my-app-files",
        };

        const config = generateProjectConfig(answers);

        expect(config.database.type).toBe("hyperdrive-postgres");
        expect(config.database.hdBinding).toBe("HYPERDRIVE");
        expect(config.database.hdName).toBe("my-postgres-hd");
        expect(config.database.hdConnectionString).toBe("postgres://user:pass@host:5432/db");
        expect(config.features.r2).toEqual({
            binding: "FILE_STORAGE",
            bucketName: "my-app-files",
        });
    });

    test("generates correct wrangler commands for D1", () => {
        const answers: GenerateAnswers = {
            appName: "test-app",
            template: "hono",
            database: "d1",
            d1Name: "test-db",
            d1Binding: "DATABASE",
            geolocation: false,
            kv: true,
            kvBinding: "KV",
            kvNamespaceName: "test-sessions",
            r2: true,
            r2Binding: "R2_BUCKET",
            r2BucketName: "test-files",
        };

        const commands = generateWranglerCommands(answers);

        expect(commands).toContain("wrangler d1 create test-db");
        expect(commands).toContain('wrangler kv:namespace create "test-sessions"');
        expect(commands).toContain("wrangler r2 bucket create test-files");
    });

    test("generates correct wrangler commands for Hyperdrive", () => {
        const answers: GenerateAnswers = {
            appName: "test-app",
            template: "nextjs",
            database: "hyperdrive-mysql",
            hdBinding: "HYPERDRIVE",
            hdName: "test-mysql",
            hdConnectionString: "mysql://user:pass@host:3306/db",
            geolocation: false,
            kv: false,
            r2: false,
        };

        const commands = generateWranglerCommands(answers);

        expect(commands).toContain(
            'wrangler hyperdrive create test-mysql --connection-string="mysql://user:pass@host:3306/db"'
        );
        expect(commands).not.toContain("wrangler d1 create");
        expect(commands).not.toContain("wrangler kv:namespace create");
        expect(commands).not.toContain("wrangler r2 bucket create");
    });

    test("generates install commands for different package managers", () => {
        const answers: GenerateAnswers = {
            appName: "test-app",
            template: "hono",
            database: "hyperdrive-postgres",
            hdBinding: "HYPERDRIVE",
            geolocation: false,
            kv: false,
            r2: false,
        };

        const bunCommands = generateInstallCommands(answers, "bun");
        const npmCommands = generateInstallCommands(answers, "npm");

        expect(bunCommands).toContain("bun install");
        expect(bunCommands).toContain("bun add postgres");

        expect(npmCommands).toContain("npm install");
        expect(npmCommands).toContain("npm install postgres");
    });

    test("generates script commands for D1", () => {
        const answers: GenerateAnswers = {
            appName: "test-app",
            template: "hono",
            database: "d1",
            d1Binding: "DATABASE",
            geolocation: false,
            kv: false,
            r2: false,
        };

        const commands = generateScriptCommands(answers, "bun");

        expect(commands).toContain("bun run auth:update");
        expect(commands).toContain("bun run db:generate");
        expect(commands).toContain("bun run db:migrate:dev");
        expect(commands).toContain("bun run db:migrate:prod");
    });

    test("generates script commands for Hyperdrive", () => {
        const answers: GenerateAnswers = {
            appName: "test-app",
            template: "nextjs",
            database: "hyperdrive-postgres",
            hdBinding: "HYPERDRIVE",
            geolocation: false,
            kv: false,
            r2: false,
        };

        const commands = generateScriptCommands(answers, "pnpm");

        expect(commands).toContain("pnpm run auth:update");
        expect(commands).toContain("pnpm run db:generate");
        expect(commands).toContain("pnpm run db:push");
        expect(commands).not.toContain("pnpm run db:migrate:dev");
    });

    test("handles minimal configuration", () => {
        const answers: GenerateAnswers = {
            appName: "minimal-app",
            template: "hono",
            database: "d1",
            d1Name: "minimal-db",
            d1Binding: "DATABASE",
            geolocation: false,
            kv: false,
            r2: false,
        };

        const config = generateProjectConfig(answers);
        const commands = generateWranglerCommands(answers);

        expect(config.features.kv).toBe(false);
        expect(config.features.r2).toBe(false);
        expect(commands).toHaveLength(1); // Only D1 command
        expect(commands[0]).toBe("wrangler d1 create minimal-db");
    });
});
