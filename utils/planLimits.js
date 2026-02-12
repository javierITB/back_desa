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
        const currentDb = req.db;
        const dbName = currentDb.databaseName;

        // 2. Bypass para formsdb (sistema global)
        if (dbName === "formsdb") {
            return true;
        }

        let limits = null;

        // 3. Prioridad: Buscar límites en la DB local (config_plan)
        try {
            const localConfig = await currentDb.collection("config_plan").findOne({});
            if (localConfig && localConfig.planLimits) {
                limits = localConfig.planLimits;
            }
        } catch (e) {
            console.warn("[PlanLimits] Error reading local config_plan:", e.message);
        }

        // 4. Fallback: Buscar en la configuración de empresa en FormsDB
        if (!limits) {
            const user = overrideUser || (req.body.user ? req.body.user : req.user);
            let empresaName = user?.empresa;

            if (empresaName && empresaName.includes(":")) {
                try { empresaName = decrypt(empresaName); } catch (e) { }
            }

            if (empresaName) {
                const dbForms = req.mongoClient.db("formsdb");
                const companyConfig = await dbForms.collection("config_empresas").findOne({ name: empresaName });
                if (companyConfig && companyConfig.planLimits) {
                    limits = companyConfig.planLimits;
                }
            }
        }

        if (!limits) {
            return true;
        }

        let limitValue = null;
        let currentCount = 0;

        switch (type) {
            case 'tickets':
                limitValue = limits.tickets?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("tickets").countDocuments();
                }
                break;

            case 'requests':
                // Soporte para ambos nombres y estructuras (objeto o valor directo)
                const reqLimit = limits.requests ?? limits.solicitudes;
                if (reqLimit !== undefined && reqLimit !== null) {
                    limitValue = (typeof reqLimit === 'object') ? reqLimit.maxTotal : reqLimit;
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

            case 'configTickets':
                limitValue = limits.configTickets?.maxCategories;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("config_tickets").countDocuments();
                }
                break;

            case 'companies':
                limitValue = limits.companies?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("empresas").countDocuments();
                }
                break;

            default:
                return true;
        }

        // 5. Comparar límite
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
