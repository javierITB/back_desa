const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { validarToken } = require("../utils/validarToken.js");
const { registerCargoCreationEvent, registerCargoUpdateEvent } = require("../utils/registerEvent");
const { decrypt } = require("../utils/seguridad.helper");

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

router.use(express.json({ limit: "4mb" }));

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
         updatedAt: new Date(),
      };

      if (!id) {
         // CREAR ROL
         // Plan Limites
         const { checkPlanLimits } = require("../utils/planLimits");
         try {
            await checkPlanLimits(req, "roles");
         } catch (limitErr) {
            return res.status(403).json({ error: limitErr.message });
         }

         roleData.createdAt = new Date();
         const result = await req.db.collection("roles").insertOne(roleData);

         registerCargoCreationEvent(req, tokenCheck, roleData);

         res.status(201).json({ _id: result.insertedId, ...roleData });
      } else {
         // ACTUALIZAR ROL
         if (id === "admin") {
            return res.status(403).json({ error: "No se puede modificar el rol raíz de administrador" });
         }

         const isUserMaestro = tokenCheck.data.rol?.toLowerCase() === "maestro";

         const currentCargoState = await req.db.collection("roles").findOne({ _id: new ObjectId(id) });
         if (!currentCargoState) return res.status(404).json({ error: "Rol no encontrado" });

         // Proteccion Maestro: Solo un Maestro puede editar un Maestro
         if (currentCargoState.name?.toLowerCase() === "maestro" && !isUserMaestro) {
            return res.status(403).json({ error: "No tienes permisos para modificar el rol Maestro" });
         }

         // Evitar que alguien asigne el nombre "Maestro" si no lo es
         if (roleData.name.toLowerCase() === "maestro" && !isUserMaestro) {
            return res.status(403).json({ error: "No puedes asignar el nombre Maestro a un rol" });
         }

         const newCargoState = await req.db
            .collection("roles")
            .findOneAndUpdate({ _id: new ObjectId(id) }, { $set: roleData }, { returnDocument: "after" });

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
 * @route   GET /roles/config
 * @desc    Obtener la configuración de roles (permisos disponibles) de la empresa actual
 */
router.get("/config", async (req, res) => {
   try {
      const tokenCheck = await verifyRequest(req);
      if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

      // Intentamos obtener la configuración desde la colección config_roles
      const configRoles = await req.db.collection("config_roles").find({}).toArray();

      res.json(configRoles);
   } catch (err) {
      console.error("Error en GET /roles/config:", err);
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

      const isUserMaestro = tokenCheck.data.rol?.toLowerCase() === "maestro";

      const roles = await req.db.collection("roles").find({}).sort({ name: 1 }).toArray();

      // Filtrar Maestro si el usuario no es Maestro
      const filteredRoles = isUserMaestro ? roles : roles.filter((r) => r.name?.toLowerCase() !== "maestro");

      res.json(filteredRoles);
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
         name: { $regex: new RegExp(`^${roleName}$`, "i") },
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
         _id: new ObjectId(req.params.id),
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

      // 1. Evitar borrar el admin o maestro
      const isUserMaestro = tokenCheck.data.rol?.toLowerCase() === "maestro";

      if (roleId === "admin") {
         return res.status(403).json({ error: "No se puede eliminar un rol de sistema" });
      }

      const roleToDelete = await req.db.collection("roles").findOne({ _id: new ObjectId(roleId) });
      if (roleToDelete && roleToDelete.name?.toLowerCase() === "maestro") {
         if (!isUserMaestro) {
            return res.status(403).json({ error: "No tienes permisos para eliminar el rol Maestro" });
         }
         // Incluso si es maestro, tal vez no debería borrarse? El usuario dijo "no se puede modificar"
         // Mantenemos protección alta:
         return res.status(403).json({ error: "El rol Maestro es vital para el sistema y no puede eliminarse" });
      }

      // 2. Verificar si hay usuarios con este rol antes de borrar
      // Nota: Aquí buscamos en tu colección de 'usuarios'
      const usersCount = await req.db.collection("usuarios").countDocuments({
         roleId: roleId,
      });

      if (usersCount > 0) {
         return res.status(400).json({
            error: "No se puede eliminar: Hay usuarios asignados a este rol.",
         });
      }

      const result = await req.db.collection("roles").deleteOne({
         _id: new ObjectId(roleId),
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

      const hasPermission = role.permissions.includes("all") || role.permissions.includes(req.params.permission);

      res.json({ hasPermission });
   } catch (err) {
      res.status(500).json({ error: "Internal server error" });
   }
});

router.get("/user-count", async (req, res) => {
   try {
      const tokenCheck = await verifyRequest(req);
      if (!tokenCheck.ok) return res.status(401).json({ error: "Unauthorized" });

      const users = await req.db
         .collection("usuarios")
         .find(
            {},
            {
               projection: {
                  cargo: 1,
               },
            },
         )
         .toArray();

      const cargos = users.map((u) => {
         try {
            return decrypt(u.cargo);
         } catch {
            return u.cargo;
         }
      });

      res.json(cargos);
   } catch (err) {
      console.error("Error en GET /roles/users:", err);
      res.status(500).json({ error: "Error al obtener usuarios" });
   }
});

module.exports = router;
