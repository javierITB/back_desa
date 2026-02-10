const express = require("express");
const router = express.Router();
const { PERMISSION_GROUPS } = require("../config/permissions");

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
        console.log(`[SAS] Connected to formsdb, query config-empresas...`);

        const companies = await db.collection("config-empresas").find().toArray();
        console.log(`[SAS] Found ${companies.length} companies`);

        res.json(companies);
    } catch (error) {
        console.error("[SAS] Error al obtener empresas:", error);
        res.status(500).json({ error: "Error al obtener empresas", details: error.message });
    }
});

// POST /companies: Crear nueva empresa y su base de datos
router.post("/companies", async (req, res) => {
    console.log(`[SAS] POST /companies request received`, req.body);
    try {
        const { name, features } = req.body;
        if (!name) return res.status(400).json({ error: "El nombre es requerido" });

        const dbForms = getFormsDB(req);

        // 1. Verificar si ya existe
        const existing = await dbForms.collection("config-empresas").findOne({ name });
        if (existing) {
            console.warn(`[SAS] Company ${name} already exists`);
            return res.status(400).json({ error: "La empresa ya existe" });
        }

        // 2. Crear entrada en formsdb.config-empresas
        // Normalizamos el nombre de la DB: minúsculas y sin caracteres especiales
        const dbName = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
        console.log(`[SAS] Creating company: ${name}, DB: ${dbName}`);

        const newCompany = {
            name,
            dbName,
            features: features || [],
            createdAt: new Date(),
            active: true
        };

        await dbForms.collection("config-empresas").insertOne(newCompany);

        // 3. Inicializar la nueva Base de Datos
        console.log(`[SAS] Initializing database: ${dbName}`);
        const newDb = req.mongoClient.db(dbName);

        // 3.1 Crear colecciones base (excluyendo config-empresas)
        const collectionsToCreate = [
            "usuarios",
            "roles",
            "config_roles"
            // Features adicionales se crearían según el array 'features' si fuera necesario, 
            // pero MongoDB crea colecciones bajo demanda. Aquí inicializamos las críticas.
        ];

        // Crear colecciones explícitamente para asegurar que la DB exista físicamente
        for (const col of collectionsToCreate) {
            // createCollection lanza error si ya existe, usamos try/catch o listCollections
            const cols = await newDb.listCollections({ name: col }).toArray();
            if (cols.length === 0) {
                await newDb.createCollection(col);
            }
        }

        // 3.2 Generar config_roles basado en features seleccionadas
        // Filtramos PERMISSION_GROUPS basado en las features habilitadas
        // Si features está vacío o es ["all"], podríamos poner todo. 
        // Por defecto, asumimos que 'features' contiene los keys de PERMISSION_GROUPS que se quieren activar.
        // Si no se envían features, activamos 'root' y 'admin' básicos por defecto? 
        // El requerimiento dice que config_roles guardará la lista de permisos.

        const rolesConfig = [];

        Object.entries(PERMISSION_GROUPS).forEach(([key, group]) => {
            // Si la feature está en la lista de features permitidas O es 'root' (siempre activa)
            // O si no se especificaron features (activar todo por defecto? O nada?)
            // Asumiremos: Si features tiene elementos, filtramos. Si no, activamos todo (o lo básico).
            // Para seguridad, activemos 'root' siempre. Y el resto si está en features.

            const isRoot = group.tagg === "root";
            const isIncluded = features && features.includes(key);

            if (isRoot || isIncluded) {
                // Formato solicitado:
                // { "_id": ..., "key": "acceso_panel_admin", "label": "Panel: Administración", "tagg": "root", "permissions": [...] }

                rolesConfig.push({
                    key: key,
                    label: group.label,
                    tagg: group.tagg,
                    permissions: group.permissions
                });
            }
        });

        if (rolesConfig.length > 0) {
            await newDb.collection("config_roles").insertMany(rolesConfig);
        }

        console.log(`[SAS] Company created successfully: ${name}`);
        res.status(201).json({ message: "Empresa creada exitosamente", company: newCompany });

    } catch (error) {
        console.error("Error al crear empresa:", error);
        res.status(500).json({ error: "Error interno al crear empresa", details: error.message });
    }
});

// DELETE /companies/:id: Eliminar empresa y su DB
router.delete("/companies/:id", async (req, res) => {
    try {
        const { id } = req.params;
        // id es el _id de la colección config-empresas. 
        // Pero necesitamos el nombre para borrar la DB.

        const dbForms = getFormsDB(req);
        const { ObjectId } = require("mongodb");

        let query = {};
        try {
            query = { _id: new ObjectId(id) };
        } catch (e) {
            query = { _id: id }; // Fallback si es string custom
        }

        const company = await dbForms.collection("config-empresas").findOne(query);

        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        // 1. Eliminar de config-empresas
        await dbForms.collection("config-empresas").deleteOne(query);

        // 2. Eliminar la base de datos física
        if (company.dbName) {
            const dbDrop = req.mongoClient.db(company.dbName);
            await dbDrop.dropDatabase();
        }

        res.json({ message: "Empresa y base de datos eliminadas" });

    } catch (error) {
        console.error("Error al eliminar empresa:", error);
        res.status(500).json({ error: "Error al eliminar empresa" });
    }
});


// POST /fix-roles: Endpoint utilitario para arreglar roles de DB existente (ej: domiciliovirtual)
router.post("/fix-roles", async (req, res) => {
    try {
        const { dbName } = req.body;
        if (!dbName) return res.status(400).json({ error: "dbName requerido" });

        const targetDb = req.mongoClient.db(dbName);

        // Limpiamos config_roles actual
        await targetDb.collection("config_roles").deleteMany({});

        // Regeneramos con TODOS los permisos (o lógica específica)
        // Para domiciliovirtual, asumiremos que tiene TODAS las features activas para que funcione todo.
        const rolesConfig = [];

        Object.entries(PERMISSION_GROUPS).forEach(([key, group]) => {
            rolesConfig.push({
                key: key,
                label: group.label,
                tagg: group.tagg,
                permissions: group.permissions
            });
        });

        if (rolesConfig.length > 0) {
            await targetDb.collection("config_roles").insertMany(rolesConfig);
        }

        res.json({ message: `Roles regenerados para ${dbName}`, count: rolesConfig.length });

    } catch (error) {
        console.error("Error fixing roles:", error);
        res.status(500).json({ error: "Error fixing roles" });
    }
});

module.exports = router;
