const { ObjectId } = require("mongodb");
const { decrypt } = require("./seguridad.helper");

/**
 * @param {Object} req 
 * @param {string} type 
 * @param {Object} [overrideUser] 
 * @returns {Promise<boolean>} 
 */
async function checkPlanLimits(req, type, overrideUser = null) {
    try {
        const dbForms = req.mongoClient.db("formsdb");
        const user = overrideUser || (req.body.user ? req.body.user : req.user);

        // 1. Identify Company/DB
        let empresaName = null;

        if (user && user.empresa) {
            empresaName = user.empresa;
            if (empresaName.includes(":")) {
                try {
                    empresaName = decrypt(empresaName);
                } catch (e) {
                    console.error("Error decrypting company in checkPlanLimits:", e);
                }
            }
        }

        console.log(`[PlanLimits] Checking ${type} for company: ${empresaName || 'Unknown'}`);

        // 2. Bypass para formsdb / system
        if (!empresaName || empresaName === "formsdb" || empresaName === "FormsDB (Principal)") {
            console.log(`[PlanLimits] Bypass triggered for system/formsdb company: ${empresaName}`);
            return true;
        }

        const currentDb = req.db;
        let limits = null;

        // 3. Cambio en db local
        try {
            const localConfig = await currentDb.collection("config_plan").findOne({});
            if (localConfig && localConfig.planLimits) {
                limits = localConfig.planLimits;
                console.log("[PlanLimits] Found limits in local config_plan");
            }
        } catch (e) {
            console.warn("[PlanLimits] Error reading local config_plan:", e.message);
        }

        // 4. Fallback a FormsDB
        if (!limits) {
            const companyConfig = await dbForms.collection("config_empresas").findOne({ name: empresaName });
            if (companyConfig && companyConfig.planLimits) {
                limits = companyConfig.planLimits;
                console.log("[PlanLimits] Found limits in FormsDB config_empresas");
            }
        }

        if (!limits) {
            console.log("[PlanLimits] No limits found for this company. Allowing request.");
            return true;
        }

        let limitValue = null;
        let currentCount = 0;
        let resourceLabel = type;

        switch (type) {
            case 'tickets':
                limitValue = limits.tickets?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("tickets").countDocuments();
                }
                break;

            case 'requests':
                // Manejar tanto objeto como valor directo para mayor robustez
                const reqLimit = limits.requests ?? limits.solicitudes;
                limitValue = (typeof reqLimit === 'object') ? reqLimit.maxTotal : reqLimit;

                if (limitValue !== undefined && limitValue !== null) {
                    currentCount = await currentDb.collection("respuestas").countDocuments();
                }
                break;

            case 'forms':
                limitValue = limits.forms?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("forms").countDocuments();
                }
                break;

            case 'templates':
                limitValue = limits.templates?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("plantillas").countDocuments();
                }
                break;

            case 'users':
                limitValue = limits.users?.maxUsers;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("usuarios").countDocuments();
                }
                break;

            case 'roles':
                limitValue = limits.roles?.maxRoles;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("roles").countDocuments();
                }
                break;

            case 'configTickets': // Categories
                limitValue = limits.configTickets?.maxCategories;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("config_tickets").countDocuments();
                }
                break;

            case 'companies': // Client Companies
                limitValue = limits.companies?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("empresas").countDocuments();
                }
                break;

            default:
                return true;
        }

        console.log(`[PlanLimits] ${type}: currentCount=${currentCount}, limitValue=${limitValue}`);

        // 5. Compare
        if (limitValue !== undefined && limitValue !== null && currentCount >= parseInt(limitValue)) {
            const LABELS = {
                tickets: "Tickets",
                requests: "Solicitudes",
                forms: "Formularios",
                templates: "Plantillas",
                users: "Usuarios",
                roles: "Roles",
                configTickets: "Categorías",
                companies: "Empresas"
            };
            const label = LABELS[type] || type;
            console.warn(`[PlanLimits] Limit reached for ${label}: ${currentCount} >= ${limitValue}`);
            throw new Error(`Límite de ${label} alcanzado.`);
        }

        return true;

    } catch (error) {
        if (error.message.startsWith("Plan limit reached") || error.message.startsWith("Límite de")) {
            throw error;
        }
        console.error(`Error checking plan limits for ${type}:`, error);
        return true;
    }
}

module.exports = { checkPlanLimits };
