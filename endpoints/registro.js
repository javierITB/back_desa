const express = require("express");
const { decrypt } = require("../utils/seguridad.helper");
const router = express.Router();


router.get("/todos", async (req, res) => {
   try {
      await verifyRequest(req);
      const events = await req.db
         .collection("cambios")
         .find({}, { projection: { error_message: 0, "actor.uid": 0 } })
         .sort({ createdAt: -1 })
         .toArray();

      const eventsProcessed = events.map(event => ({
         ...event,
         actor: decryptActor(event.actor),
      }));

      res.json(eventsProcessed);

   } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      res.status(500).json({ error: "Error al obtener registros" });
   }
});

function decryptActor(actor) {
   if (!actor || typeof actor !== 'object') return actor;
   
   const actorDeciphered = { ...actor };
   const campos = ['name', 'last_name', 'email', 'empresa'];
   
   for (const campo of campos) {
      if (actorDeciphered[campo] && actorDeciphered[campo].includes(':')) {
         try {
            actorDeciphered[campo] = decrypt(actorDeciphered[campo]);
         } catch (error) {
            console.error(`Error descifrando ${campo}:`, error);
         }
      }
   }

   return actorDeciphered;
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
