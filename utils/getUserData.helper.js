const { ObjectId } = require("mongodb");

async function getUserByTokenId(db, tokenId) {
   if (!tokenId || !ObjectId.isValid(tokenId)) {
      console.warn(`getUserByTokenId: tokenId inválido: ${tokenId}`);
      return null;
   }
   
   try {
      const result = await db.collection("tokens").aggregate([
         {
            $match: { 
               _id: new ObjectId(tokenId)
            }
         },
         {
            $lookup: {
               from: "usuarios",
               let: { userIdStr: "$userId" },
               pipeline: [
                  {
                     $match: {
                        $expr: {
                           $eq: [
                              "$_id", 
                              { $toObjectId: "$$userIdStr" }
                           ]
                        }
                     }
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
                        rol: 1
                     }
                  }
               ],
               as: "usuario"
            }
         },
         {
            $unwind: {
               path: "$usuario",
               preserveNullAndEmptyArrays: true
            }
         },
         {
            $replaceRoot: {
               newRoot: "$usuario"
            }
         }
      ]).toArray();
      
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

module.exports = { 
   getUserByTokenId
};