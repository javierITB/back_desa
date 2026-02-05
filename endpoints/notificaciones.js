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
    if (!auth.ok) return res.status(403).json({ error: "Acceso denegado" });

    const userRoleName = auth.data.rol || '';
    let hasPermission = false;

    const role = await req.db.collection("roles").findOne({ name: userRoleName });
    if (role && (role.permissions.includes('all') || role.permissions.includes('view_gestor_notificaciones'))) {
      hasPermission = true;
    }

    if (!hasPermission) {
      return res.status(403).json({ error: "Acceso denegado" });
    }

    const collection = req.db.collection("usuarios");

    const pipeline = [
      { $unwind: "$notificaciones" },
      {
        $group: {
          _id: {
            titulo: "$notificaciones.titulo",
            descripcion: "$notificaciones.descripcion",
            prioridad: "$notificaciones.prioridad",
            tipo: "$notificaciones.icono"
          },
          count: { $sum: 1 },
          usuarios: {
            $push: {
              _id: "$_id",
              nombre: "$nombre",
              empresa: "$empresa",
              mail: "$mail",
              notiId: "$notificaciones.id",
              fecha: "$notificaciones.fecha_creacion"
            }
          }
        }
      },
      { $sort: { count: -1 } }
    ];

    const results = await collection.aggregate(pipeline).toArray();

    // Desencriptar datos de usuarios
    const groups = results.map(group => {
      const decryptedUsers = group.usuarios.map(u => {
        try {
          return {
            ...u,
            nombre: decrypt(u.nombre) || "Sin nombre",
            empresa: decrypt(u.empresa) || "Sin empresa",
            mail: decrypt(u.mail) || "Sin email"
          };
        } catch (e) {
          return u;
        }
      });

      return {
        key: Buffer.from(JSON.stringify(group._id)).toString('base64'),
        titulo: group._id.titulo,
        descripcion: group._id.descripcion,
        prioridad: group._id.prioridad,
        tipo: group._id.tipo,
        count: group.count,
        usuarios: decryptedUsers
      };
    });

    res.json(groups);

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
    if (!auth.ok) return res.status(403).json({ error: "Acceso denegado" });

    const userRoleName = auth.data.rol || '';
    let hasPermission = false;

    const role = await req.db.collection("roles").findOne({ name: userRoleName });
    if (role && (role.permissions.includes('all') || role.permissions.includes('delete_gestor_notificaciones'))) {
      hasPermission = true;
    }

    if (!hasPermission) {
      return res.status(403).json({ error: "Acceso denegado. Se requiere permiso para eliminar notificaciones." });
    }

    const { titulo, descripcion, userIds } = req.body;

    if (!titulo) {
      return res.status(400).json({ error: "Falta el título para identificar notificaciones" });
    }

    let filter = {};
    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      filter._id = { $in: userIds.map(id => new ObjectId(id)) };
    }

    // Buscamos usuarios que coincidan con el filtro de ID (si hay) y que tengan la notificación
    // Y hacemos PULL de la notificación que coincida en titulo y descripcion

    const updateQuery = {
      $pull: {
        notificaciones: {
          titulo: titulo,
          ...(descripcion ? { descripcion: descripcion } : {})
        }
      }
    };

    const result = await req.db.collection("usuarios").updateMany(filter, updateQuery);

    res.json({
      message: "Proceso de eliminación completado",
      modifiedCount: result.modifiedCount
    });

  } catch (err) {
    console.error("Error eliminando notificaciones en lote:", err);
    res.status(500).json({ error: "Error al eliminar en lote" });
  }
});

module.exports = router;