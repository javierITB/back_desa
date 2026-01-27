

export async function registerEvent(req, event) {
   try {
      const payload = {
         ...event,
         createdAt: new Date(),
      };

      const collection = req.db.collection("cambios");
      const result = await collection.insertOne(payload);

      // console.log(result)

   } catch (error) {
      console.error("Error registrando evento:", error);
      return;
   }

}

// codes
export const CODES = {
   SOLICITUD_CAMBIO_ESTADO: "SOLICITUD_CAMBIO_ESTADO",
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
   FAILURE: "error",
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
