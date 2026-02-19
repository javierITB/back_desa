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

                if (reqLimit) {
                    // 1. Límite Total
                    const maxTotal = (typeof reqLimit === 'object') ? reqLimit.maxTotal : reqLimit;
                    if (maxTotal !== undefined && maxTotal !== null && maxTotal !== "") {
                        const currentTotal = await currentDb.collection("respuestas").countDocuments();
                        if (currentTotal >= parseInt(maxTotal)) {
                            throw new Error(`Límite de Solicitudes Totales alcanzado (${maxTotal}).`);
                        }
                    }

                    // Si es objeto, verificar límites de tiempo
                    if (typeof reqLimit === 'object') {
                        const now = new Date();

                        // 2. Límite Mensual
                        if (reqLimit.maxMonthly && reqLimit.maxMonthly !== "") {
                            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                            const currentMonthly = await currentDb.collection("respuestas").countDocuments({
                                createdAt: { $gte: startOfMonth }
                            });
                            if (currentMonthly >= parseInt(reqLimit.maxMonthly)) {
                                throw new Error(`Límite de Solicitudes Mensuales alcanzado (${reqLimit.maxMonthly}).`);
                            }
                        }

                        // 3. Límite Anual
                        if (reqLimit.maxYearly && reqLimit.maxYearly !== "") {
                            const startOfYear = new Date(now.getFullYear(), 0, 1);
                            const currentYearly = await currentDb.collection("respuestas").countDocuments({
                                createdAt: { $gte: startOfYear }
                            });
                            if (currentYearly >= parseInt(reqLimit.maxYearly)) {
                                throw new Error(`Límite de Solicitudes Anuales alcanzado (${reqLimit.maxYearly}).`);
                            }
                        }
                    }
                }
                break;

            case 'forms':
                limitValue = limits.forms?.maxQuantity;
                if (limitValue !== undefined) {
                    currentCount = await currentDb.collection("forms").countDocuments();
                }
                break;

            case 'bot_messages':
                limitValue = limits.chatbot?.maxQuantity;
                if (limitValue !== undefined) {
                    // Usamos agregación para sumar el tamaño del array 'messages' de todos los documentos
                    const result = await currentDb.collection("chatbot").aggregate([
                        {
                            $project: {
                                // Obtenemos el tamaño del array messages, si no existe o es nulo, devuelve 0
                                count: { $size: { $ifNull: ["$messages", []] } }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalMessages: { $sum: "$count" }
                            }
                        }
                    ]).toArray();

                    // Si hay resultados, extraemos el total; si la colección está vacía, es 0
                    currentCount = result.length > 0 ? result[0].totalMessages : 0;
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

            case 'requests_archived':
                const reqArchivedLimit = limits.requests ?? limits.solicitudes;
                if (reqArchivedLimit && typeof reqArchivedLimit === 'object' && reqArchivedLimit.maxArchived && reqArchivedLimit.maxArchived !== "") {
                    const currentArchived = await currentDb.collection("respuestas").countDocuments({ status: "archivado" });
                    if (currentArchived >= parseInt(reqArchivedLimit.maxArchived)) {
                        throw new Error(`Límite de Solicitudes Archivadas alcanzado (${reqArchivedLimit.maxArchived}).`);
                    }
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
