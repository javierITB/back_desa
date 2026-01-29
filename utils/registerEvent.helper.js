const { ObjectId } = require("mongodb");
const { encrypt } = require("../utils/seguridad.helper");

async function getActor(req, auth) {
   const tokenId = auth?.data?._id?.toString() || null;
   const userData = await getUserByTokenId(req.db, tokenId);

   if (!userData) {
      return {
         uid: null,
         name: "sistema",
         role: "system",
      };
   }

   return {
      uid: userData.uid?.toString() || null,
      name: userData.nombre || "desconocido",
      last_name: userData.apellido || "desconocido",
      role: userData.rol || "desconocido",
      email: userData.mail || "desconocido",
      empresa: userData.empresa || "desconocido",
      cargo: userData.cargo || "desconocido",
      estado: userData.estado || "desconocido",
   };
}

async function getUserByTokenId(db, tokenId) {
   if (!tokenId || !ObjectId.isValid(tokenId)) {
      console.warn(`getUserByTokenId: tokenId inválido: ${tokenId}`);
      return null;
   }

   try {
      const result = await db
         .collection("tokens")
         .aggregate([
            {
               $match: {
                  _id: new ObjectId(tokenId),
               },
            },
            {
               $lookup: {
                  from: "usuarios",
                  let: { userIdStr: "$userId" },
                  pipeline: [
                     {
                        $match: {
                           $expr: {
                              $eq: ["$_id", { $toObjectId: "$$userIdStr" }],
                           },
                        },
                     },
                     {
                        $project: {
                           _id: 1,
                           nombre: 1,
                           apellido: 1,
                           mail: 1,
                           cargo: 1,
                           empresa: 1,
                           estado: 1,
                           rol: 1,
                        },
                     },
                  ],
                  as: "usuario",
               },
            },
            {
               $unwind: {
                  path: "$usuario",
                  preserveNullAndEmptyArrays: true,
               },
            },
            {
               $replaceRoot: {
                  newRoot: "$usuario",
               },
            },
         ])
         .toArray();

      if (!result || result.length === 0) {
         console.warn(`No se encontró usuario para tokenId: ${tokenId}`);
         return null;
      }

      const usuario = result[0];

      // Agregar uid como string del _id
      usuario.uid = usuario._id.toString();

      return usuario;
   } catch (error) {
      console.error(`Error en getUserByTokenId: ${error.message}`);
      return null;
   }
}

function encryptObject(obj, seen = new WeakSet()) {
   if (!obj || typeof obj !== "object") return obj;
   if (seen.has(obj)) return obj;

   seen.add(obj);
   const resultado = {};

   for (const key in obj) {
      const valor = obj[key];

      if (typeof valor === "string" && valor.trim() !== "" && !valor.includes(":")) {
         resultado[key] = encrypt(valor);
      } else if (typeof valor === "object" && valor !== null) {
         if (Array.isArray(valor)) {
            resultado[key] = valor.map((item) => {
               if (typeof item === "string" && item.trim() !== "" && !item.includes(":")) {
                  return encrypt(item);
               } else if (typeof item === "object" && item !== null) {
                  return encryptObject(item, seen);
               }
               return item;
            });
         } else {
            resultado[key] = encryptObject(valor, seen);
         }
      } else {
         resultado[key] = valor;
      }
   }

   return resultado;
}

module.exports = {
   getActor,
   encryptObject,
};
