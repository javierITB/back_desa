const express = require("express");
const { decrypt } = require("../utils/seguridad.helper");
const router = express.Router();


router.get("/todos", async (req, res) => {
   try {
      await verifyRequest(req);
      const events = await req.db
         .collection("cambios")
         .find({}, { projection: { error_message: 0, "actor.uid": 0, result: 0 } })
         .sort({ createdAt: -1 })
         .toArray();

      const eventsProcessed = events.map(event => ({
         ...event,
         actor: decryptActor(event.actor),
         metadata: decryptMetadata(event.metadata),
      }));

      res.json(eventsProcessed);

   } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
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
