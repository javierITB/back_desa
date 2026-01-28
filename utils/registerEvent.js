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

export async function registerSolicitudCreationEvent(req, formTitle, user, auth ) {

   registerEvent(req, auth, {
      code: CODES.SOLICITUD_CREACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
      description: `${user.nombre} de la empresa ${user.empresa} ha respondido el formulario ${formTitle}`,
      metadata: {
         nombre_de_solicitud: formTitle,
      },
   });


}
// async function registerStatusChangeEvent(req, { updatedResponse, auth, result, error = null }) {
//    let description = "Cambio de estado de solicitud";

//    registerEvent(req, auth, {
//       code: CODES.SOLICITUD_CAMBIO_ESTADO,
//       target: {
//          type: TARGET_TYPES.SOLICITUD,
//          _id: updatedResponse?._id?.toString() || null,
//       },

//       description: updatedResponse
//          ? `${description} "${updatedResponse?.formTitle}" a ${updatedResponse?.status}`
//          : description + " desconocida",
//       metadata: {
//          nombre_de_solicitud: updatedResponse?.formTitle || "desconocido",
//          nuevo_estado: updatedResponse?.status || "desconocido",
//       },

//       result,
//       ...(error && { error_message: error.message }),
//    });
// }

// export async function registerRegenerateDocumentEvent(req, { respuesta, auth, result, error = null }) {

//    let description = "Regeneración de documento de solicitud";

//    registerEvent(req, auth, {
//       code: CODES.SOLICITUD_REGENERACION_DOCUMENTO,
//       target: {
//          type: TARGET_TYPES.SOLICITUD,
//          _id: respuesta?._id.toString() || null,
//       },

//       description: respuesta ? `${description} "${respuesta?.formTitle}"` : description + " desconocida",
//       metadata: {
//          nombre_de_solicitud: respuesta?.formTitle,
//       },
//       result,
//       ...(error && { error_message: error.message }),
//    });
// }

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