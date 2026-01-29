const { getUserByTokenId } = require("./getUserData.helper.js");

async function registerEvent(req, auth, event) {
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

      createdAt: new Date(),
   };

   const collection = req.db.collection("cambios");
   const result = await collection.insertOne(payload);

   if (!result.insertedId) {
      throw new Error("Error al registrar evento");
   }
}

export async function registerSolicitudCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.SOLICITUD_CREACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
      description,
      metadata
   };
   
   registerEvent(req, auth, payload);
}


// codes
const CODES = {
   SOLICITUD_CREACION: "SOLICITUD_CREACION",
   SOLICITUD_CAMBIO_ESTADO: "SOLICITUD_CAMBIO_ESTADO",
   SOLICITUD_REGENERACION_DOCUMENTO: "SOLICITUD_REGENERACION_DOCUMENTO",
};

// target types
const TARGET_TYPES = {
   SOLICITUD: "solicitud",
};
