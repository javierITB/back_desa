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

        // 3. Inicializar la nueva Base de Datos clonando de 'desarrollo'
        console.log(`[SAS] Initializing database: ${dbName} from template 'desarrollo'`);
        const newDb = req.mongoClient.db(dbName);
        const templateDb = req.mongoClient.db("desarrollo");

        // 3.1 Colecciones a clonar desde 'desarrollo'
        const collectionsToClone = [
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
                    // Quitamos los _id para que se generen nuevos en la nueva DB
                    const cleanData = data.map(doc => {
                        const { _id, ...rest } = doc;
                        return rest;
                    });
                    await newDb.collection(colName).insertMany(cleanData);
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

        // 3.2 Asegurar existencia de config_roles (se llena más abajo)
        const hasConfigRoles = (await newDb.listCollections({ name: "config_roles" }).toArray()).length > 0;
        if (!hasConfigRoles) await newDb.createCollection("config_roles");

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
            // Verificar si ya existen roles configurados para no sobrescribir/duplicar en DBs existentes
            const existingConfigCount = await newDb.collection("config_roles").countDocuments();
            if (existingConfigCount === 0) {
                await newDb.collection("config_roles").insertMany(rolesConfig);
            } else {
                console.log(`[SAS] config_roles already has ${existingConfigCount} entries. Skipping initialization.`);
            }
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

            // 3. Sincronizar roles existentes: Eliminar permisos que la empresa ya no tiene
            const existingRoles = await targetDb.collection("roles").find({}).toArray();
            for (const role of existingRoles) {
                if (role.permissions && Array.isArray(role.permissions)) {
                    const updatedPermissions = role.permissions.filter(p => selectedPermissions.includes(p));
                    if (updatedPermissions.length !== role.permissions.length) {
                        await targetDb.collection("roles").updateOne(
                            { _id: role._id },
                            { $set: { permissions: updatedPermissions } }
                        );
                    }
                }
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

module.exports = router;
