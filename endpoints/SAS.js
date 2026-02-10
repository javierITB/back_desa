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

/**
 * Helper: Obtener todas las colecciones de formsdb excepto config_empresas
 */
const getFormsDbCollections = async (mongoClient) => {
    try {
        const formsDb = mongoClient.db("formsdb");
        const collections = await formsDb.listCollections().toArray();

        // Filtrar config_empresas y colecciones de sistema
        return collections
            .map(c => c.name)
            .filter(name => name !== "config_empresas" && !name.startsWith("system."));
    } catch (err) {
        console.error("Error al obtener colecciones de formsdb:", err);
        return [];
    }
};

/**
 * Helper: Inicializar permisos en config_roles
 * Formato: Un documento por cada grupo de permisos
 */
const initializeCompanyPermissions = async (db, permissionGroups) => {
    try {
        const configRoles = db.collection("config_roles");

        // Crear un documento por cada grupo de permisos
        const permissionDocs = Object.entries(permissionGroups).map(([key, group]) => ({
            key: key,
            label: group.label,
            tagg: group.tagg,
            permissions: group.permissions
        }));

        // Insertar todos los documentos
        if (permissionDocs.length > 0) {
            await configRoles.insertMany(permissionDocs);
            console.log(`Insertados ${permissionDocs.length} documentos de permisos en config_roles`);
        }
    } catch (err) {
        console.error("Error al inicializar permisos:", err);
        throw err;
    }
};

// Definición de grupos de permisos
const PERMISSION_GROUPS = {
    // --- CONTROLADORES RAÍZ ---
    acceso_panel_cliente: {
        label: "Panel: Cliente",
        tagg: "root",
        permissions: [{ id: "view_panel_cliente", label: "Habilitar Panel de Cliente" }],
    },
    acceso_panel_admin: {
        label: "Panel: Administración",
        tagg: "root",
        permissions: [{ id: "view_panel_admin", label: "Habilitar Panel de Administración" }],
    },
    // --- VISTAS TAGG: ADMIN ---
    solicitudes_clientes: {
        label: "Vista: Solicitudes de Clientes",
        tagg: "admin",
        permissions: [
            { id: "view_solicitudes_clientes", label: "Acceso a la vista" },
            { id: "delete_solicitudes_clientes", label: "Eliminar solicitudes de clientes" },
            { id: "view_solicitudes_clientes_details", label: "Acceso a detalles de solicitudes de clientes" },
            { id: "view_solicitudes_clientes_answers", label: "Ver respuestas de solicitud de clientes", dependency: "view_solicitudes_clientes_details" },
            { id: "view_solicitudes_clientes_shared", label: "Ver usuarios compartidos", dependency: "view_solicitudes_clientes_details" },
            { id: "view_solicitudes_clientes_messages", label: "Acceso a mensajes de solicitudes de clientes" },
            { id: "create_solicitudes_clientes_messages", label: "Crear mensajes de solicitudes de clientes", dependency: "view_solicitudes_clientes_messages" },
            { id: "create_solicitudes_clientes_messages_mail", label: "Crear mensajes de solicitudes de clientes con mail", dependency: "view_solicitudes_clientes_messages" },
            { id: "view_solicitudes_clientes_messages_admin", label: "Acceso a mensajes internos de solicitudes de clientes", dependency: "view_solicitudes_clientes_messages" },
            { id: "create_solicitudes_clientes_messages_admin", label: "Crear mensajes internos en solicitudes de clientes", dependency: "view_solicitudes_clientes_messages_admin" },
            { id: "view_solicitudes_clientes_attach", label: "Ver documento adjunto", dependency: "view_solicitudes_clientes_details" },
            { id: "download_solicitudes_clientes_attach", label: "Descargar documento adjunto", dependency: "view_solicitudes_clientes_attach" },
            { id: "preview_solicitudes_clientes_attach", label: "Vista previa documento adjunto", dependency: "view_solicitudes_clientes_attach" },
            { id: "delete_solicitudes_clientes_attach", label: "Eliminar documento adjunto", dependency: "view_solicitudes_clientes_attach" },
            { id: "view_solicitudes_clientes_generated", label: "Ver documento generado", dependency: "view_solicitudes_clientes_details" },
            { id: "download_solicitudes_clientes_generated", label: "Descargar documento generado", dependency: "view_solicitudes_clientes_generated" },
            { id: "preview_solicitudes_clientes_generated", label: "Vista previa documento generado", dependency: "view_solicitudes_clientes_generated" },
            { id: "regenerate_solicitudes_clientes_generated", label: "Regenerar documento", dependency: "view_solicitudes_clientes_generated" },
            { id: "view_solicitudes_clientes_send", label: "Ver documento enviado", dependency: "view_solicitudes_clientes_details" },
            { id: "download_solicitudes_clientes_send", label: "Descargar documento enviado", dependency: "view_solicitudes_clientes_send" },
            { id: "preview_solicitudes_clientes_send", label: "Vista previa documento enviado", dependency: "view_solicitudes_clientes_send" },
            { id: "delete_solicitudes_clientes_send", label: "Eliminar documento enviado", dependency: "view_solicitudes_clientes_send" },
            { id: "create_solicitudes_clientes_send", label: "Enviar documento a cliente", dependency: "view_solicitudes_clientes_send" },
            { id: "view_solicitudes_clientes_signed", label: "Ver documento firmado", dependency: "view_solicitudes_clientes_details" },
            { id: "download_solicitudes_clientes_signed", label: "Descargar documento firmado", dependency: "view_solicitudes_clientes_signed" },
            { id: "preview_solicitudes_clientes_signed", label: "Vista previa documento firmado", dependency: "view_solicitudes_clientes_signed" },
            { id: "delete_solicitudes_clientes_signed", label: "Eliminar documento firmado", dependency: "view_solicitudes_clientes_signed" },
            { id: "edit_solicitudes_clientes_state", label: "Editar estado de solicitud", dependency: "view_solicitudes_clientes_details" },
            { id: "edit_solicitudes_clientes_finalize", label: "Finalizar solicitud", dependency: "edit_solicitudes_clientes_state" },
            { id: "edit_solicitudes_clientes_archive", label: "Archivar solicitud", dependency: "edit_solicitudes_clientes_state" },
        ]
    },
    solicitudes_a_cliente: {
        label: "Vista: Solicitudes a Cliente",
        tagg: "admin",
        permissions: [
            { id: "view_solicitudes_a_cliente", label: "Acceso a la vista" },
            { id: "create_solicitudes_a_cliente", label: "Crear solicitudes a cliente", dependency: "view_solicitudes_a_cliente" },
        ]
    },
    tickets: {
        label: "Vista: Tickets",
        tagg: "admin",
        permissions: [
            { id: "view_tickets", label: "Acceso a la vista" },
            { id: "delete_tickets", label: "Eliminar solicitudes de clientes" },
            { id: "view_tickets_details", label: "Acceso a detalles de tickets" },
            { id: "view_tickets_answers", label: "Ver tickets", dependency: "view_tickets_details" },
            { id: "accept_tickets_answers", label: "Aceptar tickets", dependency: "view_tickets_details" },
            { id: "view_tickets_attach", label: "Ver documento adjunto", dependency: "view_tickets_details" },
            { id: "download_tickets_attach", label: "Descargar documento adjunto", dependency: "view_tickets_attach" },
            { id: "preview_tickets_attach", label: "Vista previa documento adjunto", dependency: "view_tickets_attach" },
            { id: "edit_tickets_state", label: "Editar estado de ticket", dependency: "view_tickets_details" },
        ]
    },
    domicilio_virtual: {
        label: "Vista: Domicilio Virtual",
        tagg: "admin",
        permissions: [
            { id: "view_domicilio_virtual", label: "Acceso a la vista" },
            { id: "delete_domicilio_virtual", label: "Eliminar solicitudes de clientes" },
            { id: "view_domicilio_virtual_details", label: "Acceso a detalles de solicitudes de clientes" },
            { id: "view_domicilio_virtual_answers", label: "Ver respuestas de solicitud de clientes", dependency: "view_domicilio_virtual_details" },
            { id: "view_domicilio_virtual_attach", label: "Ver documento adjunto", dependency: "view_domicilio_virtual_details" },
            { id: "download_domicilio_virtual_attach", label: "Descargar documento adjunto", dependency: "view_domicilio_virtual_attach" },
            { id: "preview_domicilio_virtual_attach", label: "Vista previa documento adjunto", dependency: "view_domicilio_virtual_attach" },
            { id: "view_domicilio_virtual_generated", label: "Ver documento generado", dependency: "view_domicilio_virtual_details" },
            { id: "download_domicilio_virtual_generated", label: "Descargar documento generado", dependency: "view_domicilio_virtual_generated" },
            { id: "preview_domicilio_virtual_generated", label: "Vista previa documento generado", dependency: "view_domicilio_virtual_generated" },
            { id: "regenerate_domicilio_virtual_generated", label: "Regenerar documento", dependency: "view_domicilio_virtual_generated" },
            { id: "edit_domicilio_virtual_state", label: "Editar estado de solicitud", dependency: "view_domicilio_virtual_details" },
        ]
    },
    rendimiento: {
        label: "Vista: Rendimiento",
        tagg: "admin",
        permissions: [
            { id: "view_rendimiento", label: "Acceso a la vista" },
            { id: "view_rendimiento_previo", label: "Visualizar estadísticas de semanas anteriores", dependency: "view_rendimiento" },
            { id: "view_rendimiento_global", label: "Visualizar estadísticas globales", dependency: "view_rendimiento" },
        ]
    },
    formularios: {
        label: "Vista: Formularios",
        tagg: "admin",
        permissions: [
            { id: "view_formularios", label: "Acceso a la vista" },
            { id: "create_formularios", label: "Crear nuevos formularios", dependency: "view_formularios" },
            { id: "edit_formularios", label: "Editar formularios existentes", dependency: "view_formularios" },
            { id: "edit_formularios_propiedades", label: "Editar propiedades de formularios existentes", dependency: "edit_formularios" },
            { id: "edit_formularios_preguntas", label: "Editar preguntas de formularios existentes", dependency: "edit_formularios" },
            { id: "delete_formularios", label: "Eliminar formularios", dependency: "view_formularios" },
        ]
    },
    plantillas: {
        label: "Vista: Plantillas",
        tagg: "admin",
        permissions: [
            { id: "view_plantillas", label: "Acceso a la vista" },
            { id: "create_plantillas", label: "Crear nuevas plantillas", dependency: "view_plantillas" },
            { id: "copy_plantillas", label: "Copiar plantilla existente", dependency: "create_plantillas" },
            { id: "edit_plantillas", label: "Editar plantillas existentes", dependency: "view_plantillas" },
            { id: "delete_plantillas", label: "Eliminar plantillas", dependency: "view_plantillas" },
        ]
    },
    configuracion_tickets: {
        label: "Vista: Configuración de Tickets",
        tagg: "admin",
        permissions: [
            { id: "view_configuracion_tickets", label: "Acceso a la vista" },
            { id: "create_categoria_ticket", label: "Crear categorías de tickets", dependency: "view_configuracion_tickets" },
            { id: "edit_categoria_ticket", label: "Editar categorías de tickets", dependency: "view_configuracion_tickets" },
            { id: "delete_categoria_ticket", label: "Eliminar categorías de tickets", dependency: "edit_categoria_ticket" },
        ]
    },
    anuncios: {
        label: "Vista: Anuncios",
        tagg: "admin",
        permissions: [
            { id: "view_anuncios", label: "Acceso a la vista" },
            { id: "create_anuncios", label: "Crear anuncios web", dependency: "view_anuncios" },
            { id: "create_anuncios_web", label: "Crear anuncios web", dependency: "create_anuncios" },
            { id: "create_anuncios_mail", label: "Crear anuncios mail", dependency: "create_anuncios" },
            { id: "create_anuncios_for_all", label: "Crear anuncios para todos los usuarios", dependency: "create_anuncios" },
            { id: "create_anuncios_filter", label: "Crear anuncios para usuarios filtrados", dependency: "create_anuncios" },
            { id: "create_anuncios_manual", label: "Crear anuncios enviados manualmente", dependency: "create_anuncios" },
        ]
    },
    usuarios: {
        label: "Vista: Usuarios",
        tagg: "admin",
        permissions: [
            { id: "view_usuarios", label: "Acceso a la vista" },
            { id: "edit_usuarios", label: "Editar Usuarios", dependency: "view_usuarios" },
            { id: "delete_usuarios", label: "Eliminar Usuarios", dependency: "view_usuarios" },
            { id: "create_usuarios", label: "Crear Usuarios", dependency: "view_usuarios" },
        ]
    },
    empresas: {
        label: "Vista: Empresas",
        tagg: "admin",
        permissions: [
            { id: "view_empresas", label: "Acceso a la vista" },
            { id: "edit_empresas", label: "Editar Empresas", dependency: "view_empresas" },
            { id: "delete_empresas", label: "Eliminar Empresas", dependency: "view_empresas" },
            { id: "create_empresas", label: "Crear Empresas", dependency: "view_empresas" },
        ]
    },
    gestor_roles: {
        label: "Vista: Gestor de Roles",
        tagg: "admin",
        permissions: [
            { id: "view_gestor_roles", label: "Acceso a la vista" },
            { id: "view_gestor_roles_details", label: "Acceso a la vista detallada", dependency: "view_gestor_roles" },
            { id: "create_gestor_roles", label: "Crear nuevos roles", dependency: "view_gestor_roles" },
            { id: "copy_gestor_roles", label: "Duplicar roles existentes", dependency: "view_gestor_roles" },
            { id: "edit_gestor_roles", label: "Editar roles existentes", dependency: "view_gestor_roles_details" },
            { id: "edit_gestor_roles_by_self", label: "Editar rol propio", dependency: "view_gestor_roles_details" },
            { id: "view_gestor_roles_details_admin", label: "Acceso a la vista detallada (admin)", dependency: "view_gestor_roles" },
            { id: "edit_gestor_roles_admin", label: "Editar rol existente (Admin)", dependency: "view_gestor_roles_details" },
            { id: "delete_gestor_roles", label: "Eliminar roles", dependency: "view_gestor_roles" },
        ]
    },
    gestor_notificaciones: {
        label: "Vista: Gestor de Notificaciones",
        tagg: "admin",
        permissions: [
            { id: "view_gestor_notificaciones", label: "Acceso a la vista" },
            { id: "view_gestor_notificaciones_details", label: "Acceso a la vista detallada" },
            { id: "delete_gestor_notificaciones", label: "Eliminar notificaciones" },
        ]
    },
    registro_cambios: {
        label: "Vista: Registro de Cambios",
        tagg: "admin",
        permissions: [
            { id: "view_registro_cambios", label: "Acceso a la vista" },
            { id: "view_registro_cambios_details", label: "Acceso a la vista detallada", dependency: "view_registro_cambios" }
        ]
    },
    registro_ingresos: {
        label: "Vista: Registro de Ingresos",
        tagg: "admin",
        permissions: [{ id: "view_registro_ingresos", label: "Acceso a la vista" }]
    },
    // --- VISTAS TAGG: CLIENTE ---
    home: {
        label: "Vista: home",
        tagg: "cliente",
        permissions: [
            { id: "view_home", label: "Acceso a la vista" }
        ]
    },
    perfil: {
        label: "Vista: Perfil",
        tagg: "cliente",
        permissions: [
            { id: "view_perfil", label: "Acceso a la vista" }
        ]
    },
    mis_solicitudes: {
        label: "Vista: Mis solicitudes",
        tagg: "cliente",
        permissions: [
            { id: "view_mis_solicitudes", label: "Acceso a la vista" },
            { id: "share_mis_solicitudes", label: "Compartir solicitudes" },
            { id: "unshare_mis_solicitudes", label: "Dejar de compartir solicitudes" },
        ]
    },
    formularios_cliente: {
        label: "Vista: Formularios",
        tagg: "cliente",
        permissions: [
            { id: "view_formularios", label: "Acceso a la vista" }
        ]
    },
    formulario_cliente: {
        label: "Vista: Formulario",
        tagg: "cliente",
        permissions: [
            { id: "view_formulario", label: "Acceso a la vista" }
        ]
    }
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
 * @desc    Listar todas las empresas desde config_empresas
 */
router.get("/companies", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        if (!req.mongoClient) {
            console.error("MongoClient no disponible en req.mongoClient");
            throw new Error("MongoClient no inyectado en la petición");
        }

        console.log("GET /companies - Accediendo a formsdb.config_empresas");

        // Obtener la lista de empresas desde formsdb.config_empresas
        const formsDb = req.mongoClient.db("formsdb");
        const companies = await formsDb.collection("config_empresas")
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        console.log(`GET /companies - Encontradas ${companies.length} empresas`);
        res.json(companies);
    } catch (err) {
        console.error("Error en GET /sas/companies:", err);
        console.error("Stack trace:", err.stack);
        res.status(500).json({
            error: err.message || "Unknown SAS Error",
            _debug_context: "SAS_GET_COMPANIES",
            _timestamp: new Date().toISOString()
        });
    }
});

/**
 * @route   POST /sas/companies
 * @desc    Crear una nueva empresa (Base de Datos) con colecciones y permisos
 */
router.post("/companies", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const { name, features } = req.body;

        if (!name) return res.status(400).json({ error: "Nombre de empresa requerido" });

        // Sanitizar nombre de DB (básico)
        const dbName = name.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
        if (!dbName) return res.status(400).json({ error: "Nombre de base de datos inválido" });

        // Verificar si ya existe la empresa
        const formsDb = req.mongoClient.db("formsdb");
        const existingCompany = await formsDb.collection("config_empresas").findOne({ dbName });
        if (existingCompany) {
            return res.status(400).json({ error: "Ya existe una empresa con ese nombre" });
        }

        // 1. Obtener todas las colecciones de formsdb (excepto config_empresas)
        const collectionsToCreate = await getFormsDbCollections(req.mongoClient);

        // 2. Crear la nueva base de datos y sus colecciones
        const newDb = req.mongoClient.db(dbName);

        for (const collectionName of collectionsToCreate) {
            try {
                await newDb.createCollection(collectionName);
                console.log(`Colección creada: ${dbName}.${collectionName}`);
            } catch (e) {
                // Ignorar si ya existe
                console.log(`Colección ${collectionName} ya existe o error:`, e.message);
            }
        }

        // 3. Inicializar permisos en config_roles usando PERMISSION_GROUPS
        await initializeCompanyPermissions(newDb, PERMISSION_GROUPS);

        // 4. Guardar la configuración de la empresa en formsdb.config_empresas
        const companyConfig = {
            name: name,
            dbName: dbName,
            features: features || collectionsToCreate,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await formsDb.collection("config_empresas").insertOne(companyConfig);

        res.status(201).json({
            message: `Empresa ${name} creada exitosamente`,
            _id: result.insertedId,
            dbName,
            collections: collectionsToCreate.length
        });

    } catch (err) {
        console.error("Error en POST /sas/companies:", err);
        res.status(500).json({ error: "Internal server error", details: err.message });
    }
});

/**
 * @route   DELETE /sas/companies/:id
 * @desc    Eliminar una empresa (Base de Datos) completa
 */
router.delete("/companies/:id", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

        const companyId = req.params.id;

        // 1. Buscar la empresa en config_empresas
        const formsDb = req.mongoClient.db("formsdb");
        const company = await formsDb.collection("config_empresas").findOne({
            _id: new ObjectId(companyId)
        });

        if (!company) {
            return res.status(404).json({ error: "Empresa no encontrada" });
        }

        const dbName = company.dbName;

        // Protección extra contra borrado de system DBs
        const systemDbs = ["admin", "config", "local", "test", "formsdb", "api"];
        if (systemDbs.includes(dbName)) {
            return res.status(403).json({ error: "No se puede eliminar una base de datos de sistema" });
        }

        // 2. Eliminar la base de datos
        await req.mongoClient.db(dbName).dropDatabase();
        console.log(`Base de datos ${dbName} eliminada`);

        // 3. Eliminar el documento de config_empresas
        await formsDb.collection("config_empresas").deleteOne({ _id: new ObjectId(companyId) });

        res.json({ message: `Empresa ${company.name} eliminada exitosamente` });

    } catch (err) {
        console.error("Error en DELETE /sas/companies/:id:", err);
        res.status(500).json({ error: "Internal server error", details: err.message });
    }
});

module.exports = router;