// routes/notificaciones.helper.js - VERSIÓN CORREGIDA
const { ObjectId } = require("mongodb");
const { createBlindIndex, decrypt } = require("./seguridad.helper");

/**
 * Añade una notificación a uno o varios usuarios
 * @param {Db} db - Conexión activa a MongoDB
 * ...
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

  // Si es usuario específico
  if (userId) {
    try {
      // Intentar como ObjectId primero
      query = { _id: new ObjectId(userId) };
    } catch (error) {
      // Si no es ObjectId válido, asumir que es email
      const mailIndex = createBlindIndex(userId);
      query = { mail_index: mailIndex };
    }
  }
  // Si es por filtro
  else if (filtro) {
    const encryptedFields = ['rol', 'cargo', 'empresa', 'mail', 'nombre', 'apellido'];

    let dbQuery = { estado: 'activo' }; // Base query
    let memoryFilters = [];

    // Helper para procesar condiciones - Separar DB vs Memoria
    const processCondition = (key, value) => {
      if (encryptedFields.includes(key)) {
        memoryFilters.push({ key, value });
      } else {
        // DB Query Normal logic
        if (value && value.$in) {
          // ya viene formateado
          dbQuery[key] = value;
        } else if (Array.isArray(value)) {
          dbQuery[key] = { $in: value };
        } else {
          dbQuery[key] = value;
        }
      }
    };

    // CASO 1: Filtro con estructura compleja (desde anuncios.js - $and)
    if (filtro.$and && Array.isArray(filtro.$and)) {
      filtro.$and.forEach(condition => {
        Object.keys(condition).forEach(key => {
          processCondition(key, condition[key]);
        });
      });
    }
    // CASO 2: Filtro simple
    else {
      Object.keys(filtro).forEach(key => {
        processCondition(key, filtro[key]);
      });
    }

    // Si NO hay filtros de memoria, usamos el query directo (optimizado)
    if (memoryFilters.length === 0) {
      query = dbQuery;
    } else {
      // Si HAY filtros de memoria, debemos traer los candidatos y filtrar en JS
      // 1. Traer candidatos (filtrados por lógicas de DB como 'estado')
      const candidates = await db.collection("usuarios").find(dbQuery).toArray();

      const matchingIds = [];

      for (const u of candidates) {
        let match = true;

        for (const filter of memoryFilters) {
          // Desencriptar valor del usuario
          const userValueRaw = u[filter.key];
          const userValue = decrypt(userValueRaw);

          const filterVal = filter.value;

          // Lógica de comparación
          if (filterVal && filterVal.$in && Array.isArray(filterVal.$in)) {
            if (!filterVal.$in.includes(userValue)) match = false;
          } else if (Array.isArray(filterVal)) {
            if (!filterVal.includes(userValue)) match = false;
          } else {
            if (userValue !== filterVal) match = false;
          }

          if (!match) break;
        }

        if (match) {
          matchingIds.push(u._id);
        }
      }

      // Si nadie coincide, forzamos un query que no devuelva nada
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