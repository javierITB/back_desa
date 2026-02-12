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

        // 2. Bypass para formsdb / system
        if (!empresaName || empresaName === "formsdb" || empresaName === "FormsDB (Principal)") {
            return true;
        }

        const currentDb = req.db;
        let limits = null;

        // 3. Cambio en db local
        try {
            const localConfig = await currentDb.collection("config_plan").findOne({});
            if (localConfig && localConfig.planLimits) {
                limits = localConfig.planLimits;
            }
        } catch (e) {
            console.warn("[PlanLimits] Error reading local config_plan:", e.message);
        }

        // 4. Fallback a FormsDB
        if (!limits) {
            const companyConfig = await dbForms.collection("config_empresas").findOne({ name: empresaName });
            if (companyConfig && companyConfig.planLimits) {
                limits = companyConfig.planLimits;
            }
        }

        if (!limits) {
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
                limitValue = limits.requests?.maxTotal;
                if (limitValue !== undefined) {
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

        // 5. Compare
        if (limitValue !== undefined && limitValue !== null && currentCount >= parseInt(limitValue)) {
            throw new Error(`Plan limit reached for ${resourceLabel}. Limit: ${limitValue}, Current: ${currentCount}`);
        }

        return true;

    } catch (error) {
        if (error.message.startsWith("Plan limit reached")) {
            throw error;
        }
        console.error(`Error checking plan limits for ${type}:`, error);
        return true;
    }
}

module.exports = { checkPlanLimits };
