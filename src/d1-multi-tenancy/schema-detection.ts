/**
 * Schema Detection and Management for D1 Multi-Tenancy
 * 
 * Helps detect which tables should go to main vs tenant databases,
 * especially when plugins add new tables with relationships.
 */

/**
 * Options for schema detection
 */
export interface SchemaDetectionOptions {
    /**
     * The full Drizzle schema object containing all tables
     */
    schema: Record<string, any>;
    
    /**
     * Core model names (from multi-tenancy config)
     */
    coreModels: Set<string>;
    
    /**
     * Enable debug logging
     */
    debugLogs?: boolean;
}

/**
 * Result of schema detection
 */
export interface DetectedSchemas {
    /**
     * Tables that should remain in main database
     */
    mainSchema: Record<string, any>;
    
    /**
     * Tables that should go to tenant databases
     */
    tenantSchema: Record<string, any>;
    
    /**
     * Tables with potential relationship issues
     */
    warnings: string[];
}

/**
 * Detects and separates main and tenant schemas from a full Drizzle schema
 * 
 * This function analyzes the schema and determines which tables should
 * remain in the main database vs which should be routed to tenant databases.
 * 
 * @param options - Schema detection options
 * @returns Separated schemas and any warnings
 */
export function detectSchemas(options: SchemaDetectionOptions): DetectedSchemas {
    const { schema, coreModels, debugLogs = false } = options;
    
    const mainSchema: Record<string, any> = {};
    const tenantSchema: Record<string, any> = {};
    const warnings: string[] = [];
    
    for (const [tableName, tableDef] of Object.entries(schema)) {
        if (coreModels.has(tableName)) {
            // Core table - goes to main database
            mainSchema[tableName] = tableDef;
            
            if (debugLogs) {
                console.log(`[SchemaDetection] ${tableName} -> main database`);
            }
        } else {
            // Non-core table - goes to tenant database
            tenantSchema[tableName] = tableDef;
            
            if (debugLogs) {
                console.log(`[SchemaDetection] ${tableName} -> tenant database`);
            }
            
            // Check if table has tenantId field
            const hasTenantId = tableDef && 
                               typeof tableDef === 'object' && 
                               ('tenantId' in tableDef || 'tenant_id' in tableDef);
            
            if (!hasTenantId) {
                warnings.push(
                    `Table "${tableName}" is in tenant database but doesn't have a tenantId field. ` +
                    `This may cause routing issues. Consider adding a tenantId field or moving it to main database.`
                );
            }
        }
    }
    
    return {
        mainSchema,
        tenantSchema,
        warnings,
    };
}

/**
 * Analyzes schema for cross-database relationships
 * 
 * Detects when tenant tables reference main tables or vice versa,
 * which can cause issues since they're in separate databases.
 * 
 * @param mainSchema - Main database schema
 * @param tenantSchema - Tenant database schema
 * @param debugLogs - Enable debug logging
 * @returns List of detected cross-database references
 */
export function analyzeCrossDbReferences(
    mainSchema: Record<string, any>,
    tenantSchema: Record<string, any>,
    debugLogs = false
): string[] {
    const issues: string[] = [];
    
    const mainTableNames = new Set(Object.keys(mainSchema));
    const tenantTableNames = new Set(Object.keys(tenantSchema));
    
    // Check tenant tables for references to main tables
    for (const [tenantTableName, tenantTableDef] of Object.entries(tenantSchema)) {
        if (!tenantTableDef || typeof tenantTableDef !== 'object') continue;
        
        // Look for fields that might be foreign keys to main tables
        // Common patterns: userId, accountId, organizationId
        const potentialRefs = Object.keys(tenantTableDef).filter(field => 
            field.endsWith('Id') || field.endsWith('_id')
        );
        
        for (const field of potentialRefs) {
            // Extract potential table name (userId -> user, user_id -> user)
            const referencedTable = field.replace(/Id$/, '').replace(/_id$/, '');
            const referencedTablePlural = referencedTable + 's';
            
            if (mainTableNames.has(referencedTable) || mainTableNames.has(referencedTablePlural)) {
                const issue = `Tenant table "${tenantTableName}" has field "${field}" that may reference main table "${referencedTable}". Cross-database foreign keys are not supported.`;
                issues.push(issue);
                
                if (debugLogs) {
                    console.warn(`[SchemaAnalysis] ${issue}`);
                }
            }
        }
    }
    
    return issues;
}

/**
 * Validates multi-tenancy schema configuration
 * 
 * Performs comprehensive validation of the schema setup to catch
 * common issues early.
 * 
 * @param fullSchema - Complete Drizzle schema
 * @param coreModels - Core model names
 * @param debugLogs - Enable debug logging
 * @returns Validation result with errors and warnings
 */
export function validateMultiTenancySchema(
    fullSchema: Record<string, any>,
    coreModels: Set<string>,
    debugLogs = false
): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
} {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Detect schemas
    const detected = detectSchemas({ schema: fullSchema, coreModels, debugLogs });
    warnings.push(...detected.warnings);
    
    // Check if tenant schema exists
    if (Object.keys(detected.tenantSchema).length === 0) {
        warnings.push(
            'No tenant tables detected. All tables are in main database. ' +
            'This may not be the intended multi-tenancy configuration.'
        );
    }
    
    // Check for cross-database references
    const crossDbRefs = analyzeCrossDbReferences(
        detected.mainSchema,
        detected.tenantSchema,
        debugLogs
    );
    warnings.push(...crossDbRefs);
    
    // Check if required core tables exist
    const requiredCoreTables = ['user', 'tenant'];
    for (const required of requiredCoreTables) {
        if (!detected.mainSchema[required] && !detected.mainSchema[required + 's']) {
            errors.push(
                `Required core table "${required}" not found in schema. ` +
                `Multi-tenancy requires this table to be present.`
            );
        }
    }
    
    const isValid = errors.length === 0;
    
    if (debugLogs) {
        if (isValid) {
            console.log('[SchemaValidation] ✓ Schema validation passed');
        } else {
            console.error('[SchemaValidation] ✗ Schema validation failed');
            errors.forEach(err => console.error(`  - ${err}`));
        }
        
        if (warnings.length > 0) {
            console.warn(`[SchemaValidation] ${warnings.length} warning(s):`);
            warnings.forEach(warn => console.warn(`  - ${warn}`));
        }
    }
    
    return { isValid, errors, warnings };
}
