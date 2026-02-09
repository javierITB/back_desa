const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { validarToken } = require("../utils/validarToken.js");
const { registerCargoCreationEvent, registerCargoUpdateEvent } = require("../utils/registerEvent");

// Helper para verificar token (Consistente con tu estructura)
const verifyRequest = async (req) => {
    let token = req.headers.authorization?.split(" ")[1];
    if (!token && req.body?.user?.token) token = req.body.user.token;
    if (!token && req.query?.token) token = req.query.token;

    if (!token) return { ok: false, error: "Unauthorized" };

    const valid = await validarToken(req.db, token);
    if (!valid.ok) return { ok: false, error: "Unauthorized" };

    return { ok: true, data: valid.data };
};

router.use(express.json({ limit: '4mb' }));

/**
 * @route   POST /roles
 * @desc    Crear un nuevo rol o actualizar uno existente
 */
router.post("/", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const { id, name, description, permissions, color } = req.body;

        const roleData = {
            name: name || "Nuevo Rol",
            description: description || "",
            permissions: permissions || [], // Array de strings: ["view_reports", "edit_users", etc]
            color: color || "#4f46e5",
            updatedAt: new Date()
        };

        if (!id) {
            // CREAR ROL
            roleData.createdAt = new Date();
            const result = await req.db.collection("roles").insertOne(roleData);

            registerCargoCreationEvent(req, tokenCheck, roleData);

            res.status(201).json({ _id: result.insertedId, ...roleData });
        } else {
            // ACTUALIZAR ROL
            if (id === 'admin') {
                return res.status(403).json({ error: "No se puede modificar el rol raíz de administrador" });
            }

            const currentCargoState = await req.db.collection("roles").findOne({ _id: new ObjectId(id) });
            if (!currentCargoState) return res.status(404).json({ error: "Rol no encontrado" });

            const newCargoState = await req.db.collection("roles").findOneAndUpdate(
                { _id: new ObjectId(id) },
                { $set: roleData },
                { returnDocument: "after" }
            );

            if (!newCargoState) return res.status(404).json({ error: "Rol no encontrado" });

            registerCargoUpdateEvent(req, tokenCheck, currentCargoState, newCargoState);
            res.status(200).json(newCargoState);
        }
    } catch (err) {
        console.error("Error en POST /roles:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   GET /roles
 * @desc    Obtener todos los roles (para la vista de administración)
 */
router.get("/", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const roles = await req.db.collection("roles")
            .find({})
            .sort({ name: 1 })
            .toArray();

        res.json(roles);
    } catch (err) {
        console.error("Error en GET /roles:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   GET /roles/name/:name
 * @desc    Obtener detalle de un rol por su nombre
 */
router.get("/name/:name", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const roleName = req.params.name;
        const role = await req.db.collection("roles").findOne({
            name: { $regex: new RegExp(`^${roleName}$`, "i") }
        });

        if (!role) return res.status(404).json({ error: "Rol no encontrado" });
        res.json(role);
    } catch (err) {
        console.error("Error en GET /roles/name/:name:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   GET /roles/:id
 * @desc    Obtener detalle de un rol específico
 */
router.get("/:id", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const role = await req.db.collection("roles").findOne({
            _id: new ObjectId(req.params.id)
        });

        if (!role) return res.status(404).json({ error: "Rol no encontrado" });
        res.json(role);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   DELETE /roles/:id
 * @desc    Eliminar un rol (Verificando que no tenga usuarios asignados)
 */
router.delete("/:id", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const roleId = req.params.id;

        // 1. Evitar borrar el admin
        if (roleId === 'admin' || roleId === '67a25...') { // ID quemado o flag de sistema
            return res.status(403).json({ error: "No se puede eliminar un rol de sistema" });
        }

        // 2. Verificar si hay usuarios con este rol antes de borrar
        // Nota: Aquí buscamos en tu colección de 'usuarios'
        const usersCount = await req.db.collection("usuarios").countDocuments({
            roleId: roleId
        });

        if (usersCount > 0) {
            return res.status(400).json({
                error: "No se puede eliminar: Hay usuarios asignados a este rol."
            });
        }

        const result = await req.db.collection("roles").deleteOne({
            _id: new ObjectId(roleId)
        });

        if (result.deletedCount === 0) return res.status(404).json({ error: "Rol no encontrado" });

        res.status(200).json({ message: "Rol eliminado con éxito" });
    } catch (err) {
        console.error("Error en DELETE /roles:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   GET /roles/check-permission/:permission
 * @desc    Utility para que el frontend verifique si el usuario actual tiene un permiso
 */
router.get("/check-permission/:permission", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        // El verifyRequest devuelve la data del usuario (incluyendo su rol)
        const userRoleName = tokenCheck.data.role;

        const role = await req.db.collection("roles").findOne({ name: userRoleName });

        if (!role) return res.status(403).json({ hasPermission: false });

        const hasPermission = role.permissions.includes('all') ||
            role.permissions.includes(req.params.permission);

        res.json({ hasPermission });
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// --- GESTIÓN DE BASES DE DATOS (EMPRESAS) ---

/**
 * @route   GET /sas/companies
 * @desc    Listar todas las bases de datos (Empresas) del cluster
 */
router.get("/companies", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        // Acceder al admin de Mongo para listar DBs
        // req.db es una instancia de Db. req.db.client es el MongoClient.
        const adminDb = req.db.client.db("admin").admin();
        const list = await adminDb.listDatabases();

        // Filtrar DBs de sistema
        const systemDbs = ["admin", "config", "local", "test"];
        const companies = list.databases
            .filter(db => !systemDbs.includes(db.name))
            .map(db => ({
                name: db.name,
                sizeOnDisk: db.sizeOnDisk,
                empty: db.empty
            }));

        res.json(companies);
    } catch (err) {
        console.error("Error en GET /sas/companies:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   POST /sas/companies
 * @desc    Crear una nueva empresa (Base de Datos) y sus colecciones
 */
router.post("/companies", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const { name, features } = req.body; // features: ["usuarios", "tickets", ...]

        if (!name) return res.status(400).json({ error: "Nombre de empresa requerido" });

        // Sanitizar nombre de DB (básico)
        const dbName = name.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
        if (!dbName) return res.status(400).json({ error: "Nombre de base de datos inválido" });

        const newDb = req.db.client.db(dbName);

        // Crear colecciones vacías según funcionalidades activas
        if (Array.isArray(features)) {
            for (const feature of features) {
                // Validación simple de nombre de colección
                if (typeof feature === 'string' && feature.length > 0) {
                    // createCollection lanza error si ya existe, usamos try/catch o listCollections
                    try {
                        await newDb.createCollection(feature);
                    } catch (e) {
                        // Ignorar si ya existe
                    }
                }
            }
        }

        // Siempre asegurar config_roles
        try { await newDb.createCollection("config_roles"); } catch (e) { }

        res.status(201).json({ message: `Empresa ${dbName} creada/actualizada`, dbName });

    } catch (err) {
        console.error("Error en POST /sas/companies:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route   DELETE /sas/companies/:name
 * @desc    Eliminar una empresa (Base de Datos) completa
 */
router.delete("/companies/:name", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const dbName = req.params.name;

        // Protección extra contra borrado de system DBs (aunque el filtro de GET las oculta)
        const systemDbs = ["admin", "config", "local", "test", "formsdb", "api"];
        if (systemDbs.includes(dbName)) {
            return res.status(403).json({ error: "No se puede eliminar una base de datos de sistema" });
        }

        await req.db.client.db(dbName).dropDatabase();

        res.json({ message: `Base de datos ${dbName} eliminada` });

    } catch (err) {
        console.error("Error en DELETE /sas/companies/:name:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;