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
        console.log(`[SAS] Connected to formsdb, query config_empresas...`);

        const companies = await db.collection("config_empresas").find().toArray();
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
        const { name, permissions } = req.body;
        if (!name) return res.status(400).json({ error: "El nombre es requerido" });

        const dbForms = getFormsDB(req);

        // 1. Verificar si ya existe
        const existing = await dbForms.collection("config_empresas").findOne({ name });
        if (existing) {
            console.warn(`[SAS] Company ${name} already exists`);
            return res.status(400).json({ error: "La empresa ya existe" });
        }

        // 2. Crear entrada en formsdb.config_empresas
        // Normalizamos el nombre de la DB: minúsculas y sin caracteres especiales
        const dbName = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
        console.log(`[SAS] Creating company: ${name}, DB: ${dbName}`);

        const newCompany = {
            name,
            dbName,
            permissions: permissions || [], // Guardamos los permisos granulares
            createdAt: new Date(),
            active: true
        };

        await dbForms.collection("config_empresas").insertOne(newCompany);

        // 3. Inicializar la nueva Base de Datos
        console.log(`[SAS] Initializing database: ${dbName}`);
        const newDb = req.mongoClient.db(dbName);

        // 3.1 Crear colecciones base (excluyendo config_empresas)
        const collectionsToCreate = [
            "usuarios",
            "roles",
            "config_roles"
        ];

        // Crear colecciones explícitamente y/o índices si fuera necesario
        for (const col of collectionsToCreate) {
            const cols = await newDb.listCollections({ name: col }).toArray();
            if (cols.length === 0) {
                await newDb.createCollection(col);
            }
        }

        // 3.2 Generar config_roles basado en PERMISOS seleccionados
        // Iteramos sobre todos los grupos de permisos.
        // Si el grupo tiene algún permiso activo, lo incluimos, pero FILTRANDO solo los permisos activos.

        const rolesConfig = [];
        const selectedPermissions = permissions || [];

        Object.entries(PERMISSION_GROUPS).forEach(([key, group]) => {

            // Filtramos los permisos de este grupo que están en la lista seleccionada
            // OJO: 'root' permissions (como ver panel) suelen ser necesarios si se seleccionan hijos, 
            // pero el frontend ya maneja la lógica de dependencias. Aquí confiamos en el payload.

            // IMPORTANTE: También debemos incluir permisos 'root' implícitos si queremos forzarlos, 
            // pero mejor respetar lo que manda el front.

            const groupPermissionsIncluded = group.permissions.filter(p => selectedPermissions.includes(p.id));

            if (groupPermissionsIncluded.length > 0) {
                rolesConfig.push({
                    key: key,
                    label: group.label,
                    tagg: group.tagg,
                    permissions: groupPermissionsIncluded // Solo guardamos los permisos activados
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

// PUT /companies/:id: Actualizar permisos de una empresa
router.put("/companies/:id", async (req, res) => {
    console.log(`[SAS] PUT /companies/${req.params.id} request received`, req.body);
    try {
        const { id } = req.params;
        const { permissions } = req.body;
        const { ObjectId } = require("mongodb");

        const dbForms = getFormsDB(req);

        let query = {};
        try {
            query = { _id: new ObjectId(id) };
        } catch (e) {
            // Fallback por si usamos el nombre como ID o un string custom
            // Pero idealmente el front manda el _id. Si el front manda nombre en modal, ajustar.
            // El modal actual usa company._id si existe, o company.name si no.
            // Vamos a intentar buscar por _id primero, si falla, asumimos que id es el nombre (deprecated pero safe)
            query = { name: id };
        }

        // Mejor estrategia: buscar por _id si es válido, sino por name
        if (ObjectId.isValid(id)) {
            query = { _id: new ObjectId(id) };
        } else {
            query = { name: id };
        }

        const company = await dbForms.collection("config_empresas").findOne(query);
        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        // 1. Actualizar config_empresas
        await dbForms.collection("config_empresas").updateOne(query, {
            $set: { permissions: permissions || [] }
        });

        // 2. Regenerar config_roles en la DB objetivo
        if (company.dbName) {
            console.log(`[SAS] Updating roles for DB: ${company.dbName}`);
            const targetDb = req.mongoClient.db(company.dbName);

            // Limpiar config_roles actual
            await targetDb.collection("config_roles").deleteMany({});

            // Generar nuevo config roles basado en nuevos permisos
            const rolesConfig = [];
            const selectedPermissions = permissions || [];

            Object.entries(PERMISSION_GROUPS).forEach(([key, group]) => {
                const groupPermissionsIncluded = group.permissions.filter(p => selectedPermissions.includes(p.id));
                if (groupPermissionsIncluded.length > 0) {
                    rolesConfig.push({
                        key: key,
                        label: group.label,
                        tagg: group.tagg,
                        permissions: groupPermissionsIncluded
                    });
                }
            });

            if (rolesConfig.length > 0) {
                await targetDb.collection("config_roles").insertMany(rolesConfig);
            }
        }

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

        // 1. Eliminar de config_empresas
        await dbForms.collection("config_empresas").deleteOne(query);

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
