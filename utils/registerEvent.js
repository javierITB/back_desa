const { getActor, encryptObject } = require("./registerEvent.helper.js");
const { encrypt, decrypt } = require("../utils/seguridad.helper");

async function registerEvent(req, auth, event, metadata = {}, descriptionBuilder = null) {
   const actor = await getActor(req, auth);

   const description = typeof descriptionBuilder === "function" ? descriptionBuilder(actor) || "" : event.description;
   const finalDescription =
      typeof description === "string" && description.trim() !== "" && !description.includes(":")
         ? encrypt(description)
         : description;

   const payload = {
      ...event,
      actor,
      description: finalDescription,
      metadata: metadata && Object.keys(metadata).length ? encryptObject(metadata) : metadata,
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
      description,
   };

   await registerEvent(req, auth, payload, metadata);
}

async function registerSolicitudRemovedEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) => `El usuario ${decrypt(actor?.name) || "desconocido"} eliminó una solicitud`;

   const payload = {
      code: CODES.SOLICITUD_ELIMINACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerTicketCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.TICKET_CREACION,
      target: {
         type: TARGET_TYPES.TICKET,
      },
      description,
   };

   await registerEvent(req, auth, payload, metadata);
}

async function registerTicketRemovedEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) => `El usuario ${decrypt(actor?.name) || "desconocido"} eliminó un ticket`;
   const payload = {
      code: CODES.TICKET_ELIMINACION,
      target: {
         type: TARGET_TYPES.TICKET,
      },
   };
   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

// codes
const CODES = {
   SOLICITUD_CREACION: "SOLICITUD_CREACION",
   SOLICITUD_ELIMINACION: "SOLICITUD_ELIMINACION",
   TICKET_CREACION: "TICKET_CREACION",
   TICKET_ELIMINACION: "TICKET_ELIMINACION",
};

// target types
const TARGET_TYPES = {
   SOLICITUD: "solicitud",
   TICKET: "ticket",
};

module.exports = {
   registerSolicitudCreationEvent,
   registerTicketCreationEvent,
   registerSolicitudRemovedEvent,
   registerTicketRemovedEvent,
};
