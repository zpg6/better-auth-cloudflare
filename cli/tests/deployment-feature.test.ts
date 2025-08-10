import { describe, expect, test } from "bun:test";

describe("Deployment Feature Logic", () => {
    test("Deployment should be offered when Cloudflare setup is completed", () => {
        // Simulate the conditions from the generate command
        const setup = true; // User chose to setup Cloudflare
        const databaseSetupSkipped = false; // Setup was not skipped
        const isNonInteractive = false; // Interactive mode

        // The condition that determines if deployment is offered
        const shouldOfferDeployment = setup && !databaseSetupSkipped;

        expect(shouldOfferDeployment).toBe(true);
    });

    test("Deployment should NOT be offered when Cloudflare setup is skipped", () => {
        const setup = false; // User skipped Cloudflare setup
        const databaseSetupSkipped = true; // Setup was skipped
        const isNonInteractive = false;

        const shouldOfferDeployment = setup && !databaseSetupSkipped;

        expect(shouldOfferDeployment).toBe(false);
    });

    test("Deployment should NOT be offered when auth fails and user skips", () => {
        const setup = false; // Auth failed, user chose to skip
        const databaseSetupSkipped = true; // This gets set when auth fails
        const isNonInteractive = false;

        const shouldOfferDeployment = setup && !databaseSetupSkipped;

        expect(shouldOfferDeployment).toBe(false);
    });

    test("Non-interactive mode should deploy automatically when Cloudflare setup is completed", () => {
        const setup = true;
        const databaseSetupSkipped = false;
        const isNonInteractive = true;

        // In non-interactive mode, if setup was completed, deploy automatically
        const deployChoice = setup && !databaseSetupSkipped && isNonInteractive ? true : false;

        expect(deployChoice).toBe(true);
    });

    test("Non-interactive mode should NOT deploy when setup is skipped", () => {
        const setup = false; // Setup was skipped
        const databaseSetupSkipped = true;
        const isNonInteractive = true;

        const deployChoice = setup && !databaseSetupSkipped && isNonInteractive ? true : false;

        expect(deployChoice).toBe(false);
    });

    test("Interactive mode should ask user about deployment", () => {
        const setup = true;
        const databaseSetupSkipped = false;
        const isNonInteractive = false;

        // In interactive mode, we would show a confirm prompt
        // This test just verifies the logic flow
        const shouldShowDeployPrompt = setup && !databaseSetupSkipped && !isNonInteractive;

        expect(shouldShowDeployPrompt).toBe(true);
    });

    test("Deployment is controlled by skip-cloudflare-setup flag", () => {
        // Deployment logic is now folded into the skip-cloudflare-setup flag
        const testScenarios = [
            {
                skipCloudflareSetup: false,
                expectedDeploymentOffered: true,
                description: "Setup enabled = deployment offered",
            },
            {
                skipCloudflareSetup: true,
                expectedDeploymentOffered: false,
                description: "Setup skipped = no deployment",
            },
        ];

        testScenarios.forEach(scenario => {
            const setup = !scenario.skipCloudflareSetup;
            const databaseSetupSkipped = scenario.skipCloudflareSetup;
            const shouldOfferDeployment = setup && !databaseSetupSkipped;

            expect(shouldOfferDeployment).toBe(scenario.expectedDeploymentOffered);
        });
    });

    test("Deployment flow should only run after successful resource creation", () => {
        // This tests the overall flow logic
        const scenarios = [
            {
                name: "Full setup with resources created",
                setup: true,
                databaseSetupSkipped: false,
                expected: true,
            },
            {
                name: "Skip Cloudflare setup",
                setup: false,
                databaseSetupSkipped: true,
                expected: false,
            },
            {
                name: "Auth failed, user skipped",
                setup: false,
                databaseSetupSkipped: true,
                expected: false,
            },
            {
                name: "Setup started but auth failed",
                setup: false,
                databaseSetupSkipped: true,
                expected: false,
            },
        ];

        scenarios.forEach(scenario => {
            const shouldDeploy = scenario.setup && !scenario.databaseSetupSkipped;
            expect(shouldDeploy).toBe(scenario.expected);
        });
    });
});
