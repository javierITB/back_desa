const express = require("express");
const { decrypt } = require("../utils/seguridad.helper");
const router = express.Router();


router.get("/todos", async (req, res) => {
   try {
      await verifyRequest(req);

      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100); // límite máximo de seguridad
      const skip = (page - 1) * limit;

      const collection = req.db.collection("cambios");

      // 🔹 Query base
      const query = {};

      // 🔹 Obtener total de documentos (para paginación)
      const total = await collection.countDocuments(query);

      // 🔹 Obtener página
      const events = await collection
         .find(query, {
            projection: {
               error_message: 0,
               "actor.uid": 0,
               result: 0
            }
         })
         .sort({ createdAt: -1 })
         .skip(skip)
         .limit(limit)
         .toArray();

      const eventsProcessed = events.map(event => ({
         ...event,
         actor: decryptActor(event.actor),
         description: decrypt(event.description),
         metadata: decryptMetadata(event.metadata),
      }));

      res.json({
         data: eventsProcessed,
         pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1
         }
      });

   } catch (err) {
      if (err.status) {
         return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ error: "Error al obtener registros" });
   }
});

router.get("/todos/registroempresa", async (req, res) => {
   try {
      // 0. VALIDAR CONTEXTO (Tenant)
      // Asegurar que existe una DB conectada para validar contexto
      let dbToUse = req.db;
      if (!dbToUse && req.mongoClient) {
         dbToUse = req.mongoClient.db("formsdb");
      }

      if (!dbToUse) {
         console.error("[Registro] Error: No database connection available for context validation");
         return res.status(500).json({ error: "Configuration Error: No DB connection" });
      }

      // NOTA: No bloqueamos por nombre de DB aquí porque el Admin necesita leer "cambios" de otras empresas.
      // La seguridad se garantiza validando que el TOKEN pertenezca a un Admin de FormsDB (ver abajo).

      // 1. VALIDACIÓN MANUAL (Lógica de Sesión Centralizada)
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ message: "No autorizado" });

      const token = authHeader.split(" ")[1];
      const { validarToken } = require("../utils/validarToken");

      // Validamos contra formsdb (Base Maestra donde reside tu cuenta Admin)
      const dbMaestra = req.mongoClient.db("formsdb");
      const validation = await validarToken(dbMaestra, token);

      if (!validation.ok) {
         return res.status(401).json({ message: "Acceso denegado: Sesión no válida" });
      }

      // 2. IDENTIFICACIÓN Y FILTRO DE SEGURIDAD (Acciona Admin)
      const { createBlindIndex } = require("../utils/seguridad.helper");
      const mailBusqueda = createBlindIndex(validation.data.email);

      const usuarioDB = await dbMaestra.collection("usuarios").findOne({
         mail_index: mailBusqueda
      });

      if (!usuarioDB || usuarioDB.estado !== "activo") {
         return res.status(403).json({ message: "Acceso denegado: Usuario no autorizado" });
      }

      try {
         const empresaDescifrada = decrypt(usuarioDB.empresa);
         const cargoDescifrado = decrypt(usuarioDB.cargo).trim();

         const empresaRequerida = "Acciona Centro de Negocios Spa.";
         // Cargos exactos según tus requerimientos
         const cargosAutorizados = ["Administrador", "Super User Do"];

         console.log("[Registro] Debug Privilegios:", {
            email: validation.data.email,
            empresaDB: empresaDescifrada,
            empresaReq: empresaRequerida,
            cargoDB: cargoDescifrado,
            cargosAuth: cargosAutorizados,
            matchEmpresa: empresaDescifrada === empresaRequerida,
            matchCargo: cargosAutorizados.includes(cargoDescifrado)
         });

         if (empresaDescifrada !== empresaRequerida || !cargosAutorizados.includes(cargoDescifrado)) {
            return res.status(403).json({
               message: "Acceso denegado: Privilegios insuficientes",
               detail: `Empresa: ${empresaDescifrada}, Cargo: ${cargoDescifrado}` // Temporal para debug
            });
         }
      } catch (error) {
         return res.status(500).json({ error: "Error en la verificación de identidad cifrada" });
      }

      // 3. CONFIGURACIÓN DE PAGINACIÓN
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (page - 1) * limit;

      // 4. CONSULTA EN LA DB DEL CLIENTE SELECCIONADO (req.db)
      const collection = req.db.collection("cambios");
      const total = await collection.countDocuments({});

      const events = await collection
         .find({}, {
            projection: {
               error_message: 0,
               "actor.uid": 0,
               result: 0
            }
         })
         .sort({ createdAt: -1 })
         .skip(skip)
         .limit(limit)
         .toArray();

      // 5. PROCESAMIENTO (Descifrado de datos del cliente)
      const eventsProcessed = events.map(event => ({
         ...event,
         actor: decryptActor(event.actor),
         description: decrypt(event.description),
         metadata: decryptMetadata(event.metadata),
      }));

      res.json({
         data: eventsProcessed,
         pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPrevPage: page > 1
         }
      });

   } catch (err) {
      console.error("Error en registroempresa:", err.message);
      res.status(500).json({ error: "Error al obtener registros de cambios" });
   }
});



function decryptMetadata(value) {
   if (typeof value === "string") {
      if (!value.includes(":")) return value;

      try {
         return decrypt(value);
      } catch {
         return value; // si no era cifrado real, no rompe
      }
   }

   if (Array.isArray(value)) {
      return value.map(decryptMetadata);
   }

   if (value && typeof value === "object") {
      const result = {};
      for (const key in value) {
         result[key] = decryptMetadata(value[key]);
      }
      return result;
   }

   return value;
}

function decryptActor(actor) {
   const campos = ['name', 'last_name', 'email', 'empresa', 'cargo'];
   return decryptByFields(actor, campos);
}

function decryptByFields(obj, fields = []) {
   if (!obj || typeof obj !== "object") return obj;

   const result = { ...obj };

   for (const field of fields) {
      if (typeof result[field] === "string" && result[field].includes(":")) {
         try {
            result[field] = decrypt(result[field]);
         } catch (err) {
            console.error(`Error descifrando ${field}:`, err);
         }
      }
   }

   return result;
}

const verifyRequest = async (req) => {
   const authHeader = req.headers.authorization;

   if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw { status: 401, message: "No autorizado" };
   }
   const token = authHeader.split(" ")[1];

   const { validarToken } = require("../utils/validarToken");
   const validation = await validarToken(req.db, token);
   if (!validation.ok) {
      throw { status: 401, message: "Acceso denegado: " + validation.reason };
   }
   return validation;
};




module.exports = router;
