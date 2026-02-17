const express = require("express");
const router = express.Router();
const { PERMISSION_GROUPS } = require("../config/permissions");
const { syncCompanyConfiguration } = require("../utils/sas.helper");
const { ObjectId } = require("mongodb");

// Helper para obtener la DB de formsdb (donde están las empresas)
const getFormsDB = (req) => {
    return req.mongoClient.db("formsdb");
};

// GET /companies: Listar todas las empresas
router.get("/companies", async (req, res) => {
    console.log(`[SAS] GET /companies request received`);
    try {
        if (!req.mongoClient) {
            console.error("[SAS] Error: req.mongoClient is undefined");
            return res.status(500).json({ error: "Configuration Error: No mongoClient" });
        }

        const db = getFormsDB(req);
        console.log(`[SAS] Connected to formsdb, query config_empresas...`);

        const companies = await db.collection("config_empresas").find().toArray();

        // Inyectar formsdb (principal)
        const hasFormsDb = companies.some(c => c.dbName === "formsdb");
        if (!hasFormsDb) {
            companies.unshift({
                _id: "formsdb_system", // ID virtual
                name: "FormsDB (Principal)",
                dbName: "formsdb",
                permissions: [],
                createdAt: new Date(),
                active: true,
                isSystem: true
            });
        }

        // Ordenar: formsdb primero, luego alfabético
        companies.sort((a, b) => {
            if (a.dbName === "formsdb" || a.isSystem) return -1;
            if (b.dbName === "formsdb" || b.isSystem) return 1;
            return (a.name || "").localeCompare(b.name || "");
        });

        console.log(`[SAS] Found ${companies.length} companies`);

        // Enriquecer con el tamaño de la DB
        const companiesWithStats = await Promise.all(companies.map(async (company) => {
            if (company.dbName) {
                try {
                    const companyDb = req.mongoClient.db(company.dbName);
                    const stats = await companyDb.stats();
                    return { ...company, sizeOnDisk: stats.storageSize || 0 }; // storageSize es más preciso para el espacio ocupado
                } catch (e) {
                    console.error(`Error fetching stats for ${company.dbName}:`, e.message);
                    return { ...company, sizeOnDisk: 0 };
                }
            }
            return { ...company, sizeOnDisk: 0 };
        }));

        res.json(companiesWithStats);
    } catch (error) {
        console.error("[SAS] Error al obtener empresas:", error);
        res.status(500).json({ error: "Error al obtener empresas", details: error.message });
    }
});

// POST /companies: Crear nueva empresa y su base de datos
router.post("/companies", async (req, res) => {
    console.log(`[SAS] POST /companies request received`, req.body);
    try {
        const { name, permissions: bodyPermissions, planId } = req.body;
        if (!name) return res.status(400).json({ error: "El nombre es requerido" });

        const dbForms = getFormsDB(req);

        // 1. Verificar si ya existe
        const existing = await dbForms.collection("config_empresas").findOne({ name });
        if (existing) {
            console.warn(`[SAS] Company ${name} already exists`);
            return res.status(400).json({ error: "La empresa ya existe" });
        }

        // Determinar permisos y límites (Directos vs Plan)
        let finalPermissions = bodyPermissions || [];
        let finalPlanLimits = req.body.planLimits || {};

        if (planId) {
            const plan = await dbForms.collection("planes").findOne({ _id: new ObjectId(planId) });
            if (plan) {
                finalPermissions = plan.permissions;
                finalPlanLimits = plan.planLimits;
                console.log(`[SAS] Layout initialized from Plan: ${plan.name}`);
            }
        }

        // 2. Crear entrada en formsdb.config_empresas
        const dbName = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
        console.log(`[SAS] Creating company: ${name}, DB: ${dbName}`);

        const newCompany = {
            name,
            dbName,
            permissions: finalPermissions,
            planLimits: finalPlanLimits,
            planId: planId || null,
            createdAt: new Date(),
            active: true
        };

        await dbForms.collection("config_empresas").insertOne(newCompany);

        // 3. Inicializar la nueva Base de Datos clonando de 'desarrollo'
        console.log(`[SAS] Initializing database: ${dbName} from template 'desarrollo'`);
        const newDb = req.mongoClient.db(dbName);
        const templateDb = req.mongoClient.db("desarrollo");

        // 3.1 Colecciones a clonar desde 'desarrollo'
        const collectionsToClone = [
            "empresas",
            "forms",
            "plantillas",
            "roles",
            "usuarios"
        ];

        for (const colName of collectionsToClone) {
            try {
                const data = await templateDb.collection(colName).find().toArray();
                if (data.length > 0) {
                    console.log(`[SAS] Cloning ${data.length} documents from ${colName}...`);
                    await newDb.collection(colName).insertMany(data);
                } else {
                    console.log(`[SAS] Collection ${colName} is empty in 'desarrollo'. Creating empty collection.`);
                    await newDb.createCollection(colName);
                }
            } catch (err) {
                console.error(`[SAS] Error cloning collection ${colName}:`, err.message);
                // Si falla la clonación, al menos creamos la colección vacía
                try { await newDb.createCollection(colName); } catch (e) { }
            }
        }

        // 3.1.5 AJUSTE MAESTRO: Asignar TODOS los permisos (excepto gestión de empresas/planes)
        try {
            console.log(`[SAS] Configuring 'Maestro' role permissions...`);
            const allPermissions = [];
            const excludedGroups = ["gestor_empresas", "configuracion_planes"];

            Object.entries(PERMISSION_GROUPS).forEach(([groupKey, groupData]) => {
                if (!excludedGroups.includes(groupKey)) {
                    groupData.permissions.forEach(p => allPermissions.push(p.id));
                }
            });

            // Actualizar rol Maestro en la NUEVA DB
            const maestroRole = await newDb.collection("roles").findOne({ name: "Maestro" });
            if (maestroRole) {
                await newDb.collection("roles").updateOne(
                    { _id: maestroRole._id },
                    { $set: { permissions: allPermissions } }
                );
                console.log(`[SAS] 'Maestro' role updated with ${allPermissions.length} permissions.`);
            } else {
                console.warn(`[SAS] 'Maestro' role not found in new DB. Skipping permission update.`);
            }

        } catch (err) {
            console.error(`[SAS] Error configuring Maestro role:`, err);
        }

        // 3.2 y 3.3 Inicializar configuración usando el Helper
        await syncCompanyConfiguration(req, newCompany, finalPermissions, finalPlanLimits);

        console.log(`[SAS] Company created successfully: ${name}`);
        res.status(201).json({ message: "Empresa creada exitosamente", company: newCompany });

    } catch (error) {
        console.error("Error al crear empresa:", error);
        res.status(500).json({ error: "Error interno al crear empresa", details: error.message });
    }
});

// PUT /companies/:id: Actualizar permisos de una empresa
router.put("/companies/:id", async (req, res) => {
    console.log(`[SAS] PUT /companies/${req.params.id} request received`, req.body);
    try {
        const { id } = req.params;
        const { permissions, planId, name } = req.body;
        const { ObjectId } = require("mongodb");

        const dbForms = getFormsDB(req);

        let query = {};
        if (ObjectId.isValid(id)) {
            query = { _id: new ObjectId(id) };
        } else {
            query = { name: id };
        }

        const company = await dbForms.collection("config_empresas").findOne(query);
        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        // Determinar nuevos valores
        let newPermissions = permissions;
        let newPlanLimits = req.body.planLimits;
        let newPlanId = planId;

        // Si se asigna un Plan, sobrescribimos valores
        if (planId && planId !== company.planId) {
            const plan = await dbForms.collection("planes").findOne({ _id: new ObjectId(planId) });
            if (plan) {
                newPermissions = plan.permissions;
                newPlanLimits = plan.planLimits;
                console.log(`[SAS] Applying Plan '${plan.name}' to company ${company.name}`);
            }
        }

        // 1. Actualizar config_empresas
        const updateData = {};
        if (newPermissions !== undefined) updateData.permissions = newPermissions;
        if (newPlanLimits !== undefined) updateData.planLimits = newPlanLimits;
        if (newPlanId !== undefined) updateData.planId = newPlanId;
        if (name) updateData.name = name;

        await dbForms.collection("config_empresas").updateOne(query, {
            $set: updateData
        });

        // 2. Sincronizar DB del cliente

        await syncCompanyConfiguration(req, company, newPermissions, newPlanLimits);

        res.json({ message: "Empresa actualizada exitosamente" });

    } catch (error) {
        console.error("Error al actualizar empresa:", error);
        res.status(500).json({ error: "Error interno al actualizar empresa", details: error.message });
    }
});

// DELETE /companies/:id: Eliminar empresa y su DB
router.delete("/companies/:id", async (req, res) => {
    try {
        const { id } = req.params;
        // id es el _id de la colección config_empresas. 
        // Pero necesitamos el nombre para borrar la DB.

        const dbForms = getFormsDB(req);
        const { ObjectId } = require("mongodb");

        let query = {};
        try {
            query = { _id: new ObjectId(id) };
        } catch (e) {
            query = { _id: id }; // Fallback si es string custom
        }

        const company = await dbForms.collection("config_empresas").findOne(query);

        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        // PROTECCIÓN: No permitir borrar formsdb
        if (company.dbName === "formsdb" || company.isSystem) {
            return res.status(403).json({ error: "No se puede eliminar la base de datos principal del sistema." });
        }

        // 1. Eliminar la base de datos física primero
        if (company.dbName) {
            console.log(`[SAS] Dropping database: ${company.dbName}`);
            const dbDrop = req.mongoClient.db(company.dbName);
            await dbDrop.dropDatabase();
        }

        // 2. Eliminar de config_empresas después
        await dbForms.collection("config_empresas").deleteOne(query);

        res.json({ message: "Empresa y base de datos eliminadas" });

    } catch (error) {
        console.error("Error al eliminar empresa:", error);
        res.status(500).json({ error: "Error al eliminar empresa" });
    }
});

// GET /companies/:id: Obtener detalles de una empresa (incluyendo planLimits)
router.get("/companies/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const dbForms = getFormsDB(req);
        const { ObjectId } = require("mongodb");

        let query = {};
        if (ObjectId.isValid(id)) {
            query = { _id: new ObjectId(id) };
        } else {
            query = { name: id };
        }

        const company = await dbForms.collection("config_empresas").findOne(query);

        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        res.json(company);

    } catch (error) {
        console.error("Error al obtener detalles de empresa:", error);
        res.status(500).json({ error: "Error al obtener detalles de empresa" });
    }
});

module.exports = router;
