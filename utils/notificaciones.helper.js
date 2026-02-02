// routes/notificaciones.helper.js
const { ObjectId } = require("mongodb");
const { createBlindIndex, decrypt } = require("./seguridad.helper");

/**
 * Añade una notificación a uno o varios usuarios
 * @param {Db} db - Conexión activa a MongoDB
 */
async function addNotification(
  db,
  {
    userId,
    filtro,
    titulo,
    descripcion,
    prioridad = 1,
    color = "#f5872dff",
    icono = "paper",
    actionUrl = null,
  }
) {
  if (!userId && !filtro) {
    throw new Error("Debe proporcionar un userId o un filtro de usuarios (rol/cargo).");
  }

  const notificacion = {
    id: new ObjectId().toString(),
    titulo,
    descripcion,
    prioridad,
    color,
    icono,
    actionUrl,
    leido: false,
    fecha_creacion: new Date(),
  };

  let query = {};

  if (userId) {
    try {
      query = { _id: new ObjectId(userId) };
    } catch (error) {
      const mailIndex = createBlindIndex(userId);
      query = { mail_index: mailIndex };
    }
  }
  else if (filtro) {
    const encryptedFields = ['rol', 'cargo', 'empresa', 'mail', 'nombre', 'apellido'];
    let dbQuery = { estado: 'activo' }; 
    let memoryFilters = [];

    const processCondition = (key, value) => {
      if (encryptedFields.includes(key)) {
        memoryFilters.push({ key, value });
      } else {
        if (value && value.$in) {
          dbQuery[key] = value;
        } else if (Array.isArray(value)) {
          dbQuery[key] = { $in: value };
        } else {
          dbQuery[key] = value;
        }
      }
    };

    if (filtro.$and && Array.isArray(filtro.$and)) {
      filtro.$and.forEach(condition => {
        Object.keys(condition).forEach(key => {
          processCondition(key, condition[key]);
        });
      });
    }
    else {
      Object.keys(filtro).forEach(key => {
        processCondition(key, filtro[key]);
      });
    }

    if (memoryFilters.length === 0) {
      query = dbQuery;
    } else {
      const candidates = await db.collection("usuarios").find(dbQuery).toArray();
      const matchingIds = [];

      for (const u of candidates) {
        let match = true;

        for (const filter of memoryFilters) {
          // --- ÚNICO CAMBIO REAL: Lógica de comparación con decrypt ---
          let valorEnDB = u[filter.key];
          let valorComparar = valorEnDB;

          // Si el campo tiene el formato cifrado de tu proyecto
          if (valorEnDB && typeof valorEnDB === 'string' && valorEnDB.includes(':')) {
            try {
              valorComparar = decrypt(valorEnDB);
            } catch (e) {
              valorComparar = valorEnDB;
            }
          }

          // Comparación simple para no romper lógica de negocio
          if (!valorComparar || valorComparar.toString() !== filter.value.toString()) {
            match = false;
            break;
          }
          // -----------------------------------------------------------
        }

        if (match) {
          matchingIds.push(u._id);
        }
      }

      if (matchingIds.length === 0) {
        return { notificacion, modifiedCount: 0 };
      }

      query = { _id: { $in: matchingIds } };
    }
  }

  const result = await db.collection("usuarios").updateMany(query, {
    $push: { notificaciones: notificacion },
  });

  return { notificacion, modifiedCount: result.modifiedCount };
}

module.exports = { addNotification };