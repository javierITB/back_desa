// routes/notificaciones.js - VERSIÓN CORREGIDA
const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { addNotification } = require("../utils/notificaciones.helper");
const { createBlindIndex, decrypt } = require("../utils/seguridad.helper");
const { validarToken } = require("../utils/validarToken.js"); // Importar validador de token

// Helper para verificar token (seguridad)
const verifyRequest = async (req) => {
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.body?.user?.token) token = req.body.user.token;
  if (!token && req.query?.token) token = req.query.token;

  if (!token) return { ok: false, error: "Token no proporcionado" };

  const valid = await validarToken(req.db, token);
  if (!valid.ok) return { ok: false, error: valid.reason, status: 401 };

  return { ok: true, data: valid.data };
};

// Crear una notificación (para 1 usuario o grupo)
router.post("/", async (req, res) => {
  try {
    const data = req.body;
    const { filtro, formTitle, prioridad, color, icono, actionUrl } = data;

    if (!formTitle) {
      return res.status(400).json({ error: "Faltan campos requeridos: formTitle" });
    }

    const { notificacion, modifiedCount } = await addNotification(req.db, {
      userId,
      filtro,
      formTitle: `Se ha añadido notificacion manual.`,
      descripcion: `Se a usado postman para añadir nuevas notificaciones desde fuera`,
      prioridad,
      color,
      icono,
      actionUrl,
    });

    if (modifiedCount === 0) {
      return res.status(404).json({ error: "No se encontraron usuarios para la notificación" });
    }

    res.status(201).json({
      message: "Notificación creada exitosamente",
      notificacion,
      usuarios_afectados: modifiedCount,
    });
  } catch (err) {
    console.error("Error al crear notificación:", err);
    res.status(500).json({ error: "Error al crear notificación", detalles: err.message });
  }
});

// Agrupar notificaciones similares (Mover arriba de /:nombre para evitar shadow)
router.get("/gestion/agrupadas", async (req, res) => {
  try {
    const auth = await verifyRequest(req);
    const userRole = auth.data.rol ? auth.data.rol.toLowerCase() : '';
    if (!auth.ok || (userRole !== 'admin' && userRole !== 'root')) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    // 1. Obtener todos los usuarios que tengan notificaciones
    // Proyección para traer solo lo necesario
    const users = await req.db.collection("usuarios").find(
      { "notificaciones.0": { $exists: true } }, // Solo usuarios con notificaciones
      {
        projection: {
          nombre: 1, empresa: 1, mail: 1, rol: 1, cargo: 1, notificaciones: 1
        }
      }
    ).toArray();

    const groupsMap = {};

    // 2. Procesar en JS (Lógica idéntica a la que había en Frontend anteriormente)
    users.forEach(user => {
      if (user.notificaciones && Array.isArray(user.notificaciones)) {

        // Desencriptar datos del usuario una sola vez
        const usuarioInfo = {
          _id: user._id,
          nombre: decrypt(user.nombre) || "Sin nombre",
          empresa: decrypt(user.empresa) || "Sin empresa",
          mail: decrypt(user.mail) || "Sin email",
          rol: user.rol,
          cargo: user.cargo
        };

        user.notificaciones.forEach(noti => {
          // Calcular mes
          let mes = "";
          try {
            if (noti.fecha_creacion) {
              const d = new Date(noti.fecha_creacion);
              if (!isNaN(d.getTime())) {
                mes = d.toISOString().slice(0, 7); // "YYYY-MM"
              }
            }
          } catch (e) { }

          const groupKeyObj = {
            titulo: noti.titulo,
            descripcion: noti.descripcion,
            tipo: noti.icono,
            mes: mes
          };
          const groupKey = JSON.stringify(groupKeyObj);

          if (!groupsMap[groupKey]) {
            groupsMap[groupKey] = {
              key: Buffer.from(groupKey).toString('base64'),
              titulo: noti.titulo,
              descripcion: noti.descripcion,
              tipo: noti.icono,
              mes: mes,
              prioridad: noti.prioridad, // Tomamos la prioridad del primero
              count: 0,
              usuarios: []
            };
          }

          groupsMap[groupKey].count++;
          groupsMap[groupKey].usuarios.push({
            ...usuarioInfo, // Spread de info básica desencriptada
            notiId: noti.id,
            fecha: noti.fecha_creacion,
            leido: noti.leido
          });
        });
      }
    });

    // 3. Convertir a Array y ordenar
    const groupsArray = Object.values(groupsMap).sort((a, b) => b.count - a.count);

    res.json(groupsArray);

  } catch (err) {
    console.error("Error agrupando notificaciones:", err);
    res.status(500).json({ error: "Error al agrupar notificaciones" });
  }
});

// Listar notificaciones de un usuario
router.get("/:nombre", async (req, res) => {
  try {
    const mailIndex = createBlindIndex(req.params.nombre);

    const usuario = await req.db
      .collection("usuarios")
      .findOne({ mail_index: mailIndex }, {
        projection: {
          notificaciones: 1
        }
      });

    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json(usuario.notificaciones || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener notificaciones" });
  }
});

// Marcar una notificación como leída
router.put("/:userId/:notiId/leido", async (req, res) => {
  try {
    let query;

    try {
      // Intentar como ObjectId
      query = { _id: new ObjectId(req.params.userId) };
    } catch (error) {
      // Si no es ObjectId, asumir email y usar mail_index
      const mailIndex = createBlindIndex(req.params.userId);
      query = { mail_index: mailIndex };
    }

    const result = await req.db.collection("usuarios").findOneAndUpdate(
      {
        ...query,
        "notificaciones.id": req.params.notiId
      },
      { $set: { "notificaciones.$.leido": true } },
      { returnDocument: "after" }
    );

    if (!result.value)
      return res.status(404).json({ error: "Usuario o notificación no encontrada" });

    res.json({
      message: "Notificación marcada como leída",
      usuario: result.value
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al marcar notificación como leída" });
  }
});

// Eliminar una notificación
router.delete("/:mail/:notiId", async (req, res) => {
  try {
    const mailIndex = createBlindIndex(req.params.mail);

    const result = await req.db.collection("usuarios").findOneAndUpdate(
      { mail_index: mailIndex },
      { $pull: { notificaciones: { id: req.params.notiId } } },
      { returnDocument: "after" }
    );

    if (!result)
      return res.status(404).json({
        error: "Usuario o notificación no encontrada",
        result: result
      });

    res.json({
      message: "Notificación eliminada",
      usuario: result.value
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar notificación" });
  }
});

// Eliminar todas las notificaciones de un usuario
router.delete("/:mail", async (req, res) => {
  try {
    const mailIndex = createBlindIndex(req.params.mail);

    const result = await req.db.collection("usuarios").findOneAndUpdate(
      { mail_index: mailIndex },
      { $set: { notificaciones: [] } },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({
      message: "Todas las notificaciones fueron eliminadas correctamente.",
      usuario: result.value
    });
  } catch (err) {
    console.error("Error al eliminar todas las notificaciones:", err);
    res.status(500).json({ error: "Error al eliminar notificaciones" });
  }
});

// Marcar todas las notificaciones como leídas
router.put("/:mail/leido-todas", async (req, res) => {
  try {
    const { mail } = req.params;
    const mailIndex = createBlindIndex(mail);

    const result = await req.db.collection("usuarios").updateOne(
      { mail_index: mailIndex },
      { $set: { "notificaciones.$[].leido": true } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({
      message: "Todas las notificaciones fueron marcadas como leídas",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Error al marcar todas como leídas:", err);
    res.status(500).json({ error: "Error al marcar todas las notificaciones como leídas" });
  }
});

// Obtener contador de notificaciones no leídas - VERSIÓN CORRECTA
router.get("/:mail/unread-count", async (req, res) => {
  try {
    const { mail } = req.params;

    // Usar mail_index (hash del email) para buscar
    const mailIndex = createBlindIndex(mail);

    const usuario = await req.db
      .collection("usuarios")
      .findOne({
        mail_index: mailIndex
      }, {
        projection: {
          notificaciones: 1
        }
      });

    if (!usuario) {
      return res.status(404).json({
        error: "Usuario no encontrado",
        detalle: `No se encontró usuario con mail_index: ${mailIndex}`
      });
    }

    const unreadCount = (usuario.notificaciones || []).filter(
      (n) => n.leido === false
    ).length;

    res.json({
      unreadCount,
      totalNotificaciones: usuario.notificaciones ? usuario.notificaciones.length : 0
    });
  } catch (err) {
    console.error("Error al obtener contador de no leídas:", err);
    res.status(500).json({
      error: "Error al obtener contador de notificaciones no leídas",
      detalles: err.message,
    });
  }
});

// (Ruta /gestion/agrupadas removida de aquí y movida arriba)

// Eliminar notificaciones en lote
router.post("/gestion/delete-batch", async (req, res) => {
  try {
    const auth = await verifyRequest(req);
    const userRole = auth.data.rol ? auth.data.rol.toLowerCase() : '';
    if (!auth.ok || (userRole !== 'admin' && userRole !== 'root')) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Falta array de IDs de notificaciones" });
    }

    // UPDATE: Usar IDs específicos de notificaciones para eliminar
    const result = await req.db.collection("usuarios").updateMany(
      { "notificaciones.id": { $in: ids } },
      { $pull: { notificaciones: { id: { $in: ids } } } }
    );

    res.json({
      message: "Proceso de eliminación completado",
      modifiedCount: result.modifiedCount,
      deletedCount: ids.length
    });

  } catch (err) {
    console.error("Error eliminando notificaciones en lote:", err);
    res.status(500).json({ error: "Error al eliminar en lote" });
  }
});

module.exports = router;