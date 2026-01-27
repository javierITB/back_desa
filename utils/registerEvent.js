

export async function registerEvent(req, event) {

      const payload = {
         ...event,
         createdAt: new Date(),
      };

      const collection = req.db.collection("cambios");
      const result = await collection.insertOne(payload);

      if (!result.insertedId) {
         throw new Error("Error al registrar evento");
      }

}

// codes
export const CODES = {
   SOLICITUD_CAMBIO_ESTADO: "SOLICITUD_CAMBIO_ESTADO",
   SOLICITUD_REGENERACION_DOCUMENTO: "SOLICITUD_REGENERACION_DOCUMENTO",
};

// target types
export const TARGET_TYPES = {
   SOLICITUD: "solicitud",
};

// actor roles
export const ACTOR_ROLES = {
   ADMIN: "admin",
};

// results
export const RESULTS = {
   SUCCESS: "success",
   ERROR: "error",
};

// metadata

export const STATUS = {
   PENDIENTE: "pendiente",
   EN_REVISION: "en_revisión",
   APROBADA: "aprobada",
   FIRMADA: "firmada",
   FINALIZADA: "finalizada",
   ARCHIVADA: "archivada",
};
