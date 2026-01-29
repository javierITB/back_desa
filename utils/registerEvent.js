const { getUserByTokenId, encryptObject } = require("./registerEvent.helper.js");
const { encrypt } = require("../utils/seguridad.helper");

async function registerEvent(req, auth, event, metadata = {}) {
   const tokenId = auth?.data?._id?.toString() || null;
   const userData = await getUserByTokenId(req.db, tokenId);

   const payload = {
      ...event,
      actor: {
         uid: userData?.uid?.toString() || null,
         name: userData?.nombre || "desconocido",
         last_name: userData?.apellido || "desconocido",
         role: userData?.rol || "desconocido",
         email: userData?.mail || "desconocido",
         empresa: userData?.empresa || "desconocido",
         cargo: userData?.cargo || "desconocido",
         estado: userData?.estado || "desconocido",
      },
      description:
         typeof event.description === "string" && !event.description.includes(":")
            ? encrypt(event.description)
            : event.description,

      metadata: encryptObject(metadata),
      createdAt: new Date(),
   };

   const collection = req.db.collection("cambios");
   const result = await collection.insertOne(payload);

   if (!result.insertedId) {
      throw new Error("Error al registrar evento");
   }
}

async function registerSolicitudCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.SOLICITUD_CREACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
      description
   };

   await registerEvent(req, auth, payload, metadata);
}

async function registerTicketCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.TICKET_CREACION,
      target: {
         type: TARGET_TYPES.TICKET,
      },
      description
   };

   await registerEvent(req, auth, payload, metadata);
}

// codes
const CODES = {
   SOLICITUD_CREACION: "SOLICITUD_CREACION",
   TICKET_CREACION: "TICKET_CREACION",
};

// target types
const TARGET_TYPES = {
   SOLICITUD: "solicitud",
   TICKET: "ticket",
};


module.exports = {
  registerSolicitudCreationEvent,
  registerTicketCreationEvent,
};