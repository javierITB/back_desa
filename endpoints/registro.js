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
