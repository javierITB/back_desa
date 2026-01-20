const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const multer = require('multer');
const { addNotification } = require("../utils/notificaciones.helper");
const { generarAnexoDesdeRespuesta } = require("../utils/generador.helper");
const { enviarCorreoRespaldo } = require("../utils/mailrespaldo.helper");
const { validarToken } = require("../utils/validarToken.js");
const { createBlindIndex, verifyPassword, encrypt, decrypt } = require("../utils/seguridad.helper");
const { sendEmail } = require("../utils/mail.helper");

// Función para normalizar nombres de archivos (versión completa y segura)
const normalizeFilename = (filename) => {
  if (typeof filename !== 'string') {
    filename = String(filename || `documento_sin_nombre_${Date.now()}`);
  }

  const lastDotIndex = filename.lastIndexOf('.');
  let extension = '';
  let nameWithoutExt = filename;

  if (lastDotIndex > 0 && lastDotIndex < filename.length - 1) {
    extension = filename.substring(lastDotIndex + 1);
    nameWithoutExt = filename.substring(0, lastDotIndex);
  }

  if (extension) {
    extension = extension
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 10)
      .toLowerCase();
  }

  if (!extension) extension = 'bin';

  let normalized = nameWithoutExt
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
    .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
    .replace(/Ó/g, 'O').replace(/Ú/g, 'U').replace(/Ü/g, 'U')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N').replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/[^a-zA-Z0-9\s._-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100)
    .replace(/^_+|_+$/g, '');

  if (!normalized || normalized.length === 0) {
    normalized = `documento_${Date.now()}`;
  }

  return `${normalized}.${extension}`;
};

// Configurar Multer para almacenar en memoria (buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB límite por archivo
  }
});

// Configurar Multer para múltiples archivos
const uploadMultiple = multer({
  storage: multer.memoryStorage(),
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos PDF'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite por archivo
    files: 10 // Máximo 10 archivos
  }
});

// Helper para verificar token en cualquier request
const verifyRequest = async (req) => {
  let token = req.headers.authorization?.split(" ")[1];

  // Fallback: buscar en body.user.token
  if (!token && req.body?.user?.token) token = req.body.user.token;

  // Fallback: buscar en query param
  if (!token && req.query?.token) token = req.query.token;

  if (!token) return { ok: false, error: "Token no proporcionado" };

  const valid = await validarToken(req.db, token);
  if (!valid.ok) return { ok: false, error: valid.reason };

  return { ok: true, data: valid.data };
};

router.use(express.json({ limit: '4mb' }));

// En el endpoint POST principal (/) - SOLO FORMATO ESPECÍFICO
router.post("/", async (req, res) => {
  try {
    const { formId, user, responses, formTitle, adjuntos = [], mail: correoRespaldo } = req.body;

    // Importar solo tus funciones existentes
    const { encrypt } = require('../utils/seguridad.helper');

    // El usuario que viene del frontend ya debería estar descifrado en su sesión
    const usuario = user?.nombre;
    const empresa = user?.empresa;
    const userId = user?.uid;
    const token = user?.token;

    console.log("=== INICIO GUARDAR RESPUESTA (PQC) ===");

    // Validar token
    const tokenValido = await validarToken(req.db, token);
    if (!tokenValido.ok) {
      return res.status(401).json({ error: tokenValido.reason });
    }

    // Verificar formulario
    const form = await req.db.collection("forms").findOne({ _id: new ObjectId(formId) });
    if (!form) return res.status(404).json({ error: "Formulario no encontrado" });

    // Validar empresa autorizada
    const empresaAutorizada = form.companies?.includes(empresa) || form.companies?.includes("Todas");
    if (!empresaAutorizada) {
      return res.status(403).json({ error: `La empresa ${empresa} no está autorizada.` });
    }

    // Función simple para cifrar un objeto completo campo por campo
    const cifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];

        if (typeof valor === 'string' && valor.trim() !== '' && !valor.includes(':')) {
          // Cifrar strings que no estén ya cifrados
          resultado[key] = encrypt(valor);
        } else if (typeof valor === 'object' && valor !== null) {
          // Si es objeto o array, procesar recursivamente
          if (Array.isArray(valor)) {
            resultado[key] = valor.map(item => {
              if (typeof item === 'string' && item.trim() !== '' && !item.includes(':')) {
                return encrypt(item);
              } else if (typeof item === 'object' && item !== null) {
                return cifrarObjeto(item);
              }
              return item;
            });
          } else {
            resultado[key] = cifrarObjeto(valor);
          }
        } else {
          // Otros tipos (number, boolean, null) se mantienen igual
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // 1. Cifrar objeto 'user' campo por campo
    const userCifrado = cifrarObjeto(user);

    // 2. Cifrar objeto 'responses' campo por campo
    const responsesCifrado = cifrarObjeto(responses);

    // Guardar respuesta con datos CIFRADOS
    const result = await req.db.collection("respuestas").insertOne({
      formId,
      user: userCifrado,  // ← CIFRADO campo por campo
      responses: responsesCifrado,  // ← CIFRADO campo por campo
      formTitle,
      mail: correoRespaldo,
      status: "pendiente",
      createdAt: new Date(),
      updatedAt: new Date()
    });


    // Manejar adjuntos si existen
    if (adjuntos.length > 0) {
      await req.db.collection("adjuntos").insertOne({
        responseId: result.insertedId,
        submittedAt: new Date().toISOString(),
        adjuntos: []
      });
      console.log(`Documento adjuntos creado`);
    }

    // Enviar correo de respaldo (usamos datos descifrados del user original)
    if (correoRespaldo && correoRespaldo.trim() !== '') {
      await enviarCorreoRespaldo(correoRespaldo, formTitle, user, responses, form.questions);
      console.log("✓ Correo de respaldo enviado");
    }

    // Notificaciones (RRHH y Admin) - usar datos descifrados
    const notifData = {
      titulo: `${usuario} de la empresa ${empresa} ha respondido el formulario ${formTitle}`,
      descripcion: adjuntos.length > 0 ? `Incluye ${adjuntos.length} archivo(s)` : "Revisar en panel.",
      prioridad: 2,
      color: "#bb8900ff",
      icono: "Edit",
      actionUrl: `/RespuestasForms?id=${result.insertedId}`,
    };

    await addNotification(req.db, { filtro: { cargo: "RRHH" }, ...notifData });
    await addNotification(req.db, { filtro: { cargo: "admin" }, ...notifData });
    console.log("✓ Notificaciones a RRHH y Admin enviadas");

    // Notificación al usuario
    await addNotification(req.db, {
      userId,
      titulo: "Formulario completado",
      descripcion: `El formulario ${formTitle} fue completado correctamente.`,
      prioridad: 2,
      icono: "Edit",
      color: "#006e13ff",
      actionUrl: `/?id=${result.insertedId}`,
    });
    console.log("Notificación al usuario enviada");

    // Generar documento anexo (usar datos descifrados)
    try {
      await generarAnexoDesdeRespuesta(responses, result.insertedId.toString(), req.db, form.section, {
        nombre: usuario,
        empresa: empresa,
        uid: userId,
      }, formId, formTitle);
      console.log("✓ Documento anexo generado");
    } catch (error) {
      console.error("Error generando documento:", error.message);
    }

    // Respuesta al frontend con datos DESCIFRADOS (como espera el frontend)
    res.json({
      _id: result.insertedId,
      formId,
      user,  // ← Datos descifrados (lo que el frontend espera)
      responses,  // ← Datos descifrados
      formTitle,
      mail: correoRespaldo,
      message: "Respuesta guardada exitosamente con cifrado PQC"
    });

  } catch (err) {
    console.error("Error al guardar respuesta PQC:", err);
    res.status(500).json({
      error: "Error al guardar respuesta: " + err.message,
      step: "cifrado_pqc"
    });
  }
});

router.post("/admin", async (req, res) => {
  try {
    const { formId, user: adminUser, responses, formTitle, adjuntos = [], mail: correoRespaldo } = req.body;

    const destinatarioNombre = responses?.Destinatario;
    const destinatarioEmpresa = responses?.EmpresaDestino;

    if (!destinatarioNombre || !destinatarioEmpresa) {
      return res.status(400).json({ error: "Destinatario y empresa requeridos." });
    }

    const tokenValido = await validarToken(req.db, adminUser?.token);
    if (!tokenValido.ok) return res.status(401).json({ error: tokenValido.reason });

    // --- BÚSQUEDA PQC DEL USUARIO DESTINATARIO ---
    const userDestinatario = await req.db.collection("usuarios").findOne({
      mail_index: createBlindIndex(correoRespaldo),
    });

    if (!userDestinatario) {
      return res.status(404).json({ error: `Destinatario no encontrado con el correo: ${correoRespaldo}` });
    }

    // Desciframos los datos del usuario para construir el objeto
    const destinatarioUserObject = {
      uid: userDestinatario._id.toString(),
      nombre: userDestinatario.nombre.includes(':')
        ? decrypt(userDestinatario.nombre)
        : userDestinatario.nombre,
      empresa: destinatarioEmpresa, // Usamos la empresa del formulario
      mail: correoRespaldo,
    };

    const form = await req.db.collection("forms").findOne({ _id: new ObjectId(formId) });
    if (!form) return res.status(404).json({ error: "Formulario no encontrado" });

    // Función para cifrar objetos recursivamente
    const cifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];

        if (typeof valor === 'string' && valor.trim() !== '' && !valor.includes(':')) {
          resultado[key] = encrypt(valor);
        } else if (typeof valor === 'object' && valor !== null) {
          if (Array.isArray(valor)) {
            resultado[key] = valor.map(item => {
              if (typeof item === 'string' && item.trim() !== '' && !item.includes(':')) {
                return encrypt(item);
              } else if (typeof item === 'object' && item !== null) {
                return cifrarObjeto(item);
              }
              return item;
            });
          } else {
            resultado[key] = cifrarObjeto(valor);
          }
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // CIFRAR DATOS ANTES DE GUARDAR
    const userCifrado = cifrarObjeto(destinatarioUserObject);
    const responsesCifrado = cifrarObjeto(responses);

    const now = new Date();
    const result = await req.db.collection("respuestas").insertOne({
      formId,
      user: userCifrado,  // ← CIFRADO
      responses: responsesCifrado,  // ← CIFRADO
      formTitle,
      mail: correoRespaldo,
      status: "pendiente",
      createdAt: now,
      updatedAt: now,
      injectedBy: adminUser?.uid,
    });

    if (adjuntos.length > 0) {
      await req.db.collection("adjuntos").insertOne({
        responseId: result.insertedId,
        submittedAt: now.toISOString(),
        adjuntos: []
      });
    }

    // Para el correo, usar datos DESCIFRADOS
    if (correoRespaldo) {
      await enviarCorreoRespaldo(correoRespaldo, formTitle, destinatarioUserObject, responses, form.questions);
    }

    // Notificaciones
    await addNotification(req.db, {
      filtro: { cargo: "RRHH" },
      titulo: `Solicitud creada para ${destinatarioNombre}`,
      descripcion: `El administrador ${adminUser?.nombre} creó "${formTitle}".`,
      prioridad: 2, color: "#bb8900ff", icono: "form",
      actionUrl: `/RespuestasForms?id=${result.insertedId}`,
    });

    await addNotification(req.db, {
      userId: destinatarioUserObject.uid,
      titulo: "Nueva Solicitud Administrativa",
      descripcion: `Tienes una nueva solicitud pendiente: ${formTitle}.`,
      prioridad: 2, icono: "Warning", color: "#ff8c00ff",
      actionUrl: `/?id=${result.insertedId}`,
    });

    try {
      await generarAnexoDesdeRespuesta(
        responses,  // Datos descifrados para generar documento
        result.insertedId.toString(),
        req.db,
        form.section,
        destinatarioUserObject,  // Datos descifrados
        formId,
        formTitle
      );
    } catch (error) {
      console.error("Error generando documento:", error.message);
    }

    // Responder con datos DESCIFRADOS al frontend
    res.json({
      _id: result.insertedId,
      formId,
      user: destinatarioUserObject,  // Descifrado
      responses,  // Descifrado
      formTitle,
      mail: correoRespaldo
    });

  } catch (err) {
    res.status(500).json({ error: "Error Admin: " + err.message });
  }
});

// Obtener adjuntos de una respuesta específica
router.get("/:id/adjuntos", async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const adjuntos = await req.db.collection("adjuntos")
      .findOne({ responseId: new ObjectId(id) });

    res.json(adjuntos);

  } catch (err) {
    console.error("Error obteniendo adjuntos:", err);
    res.status(500).json({ error: "Error obteniendo adjuntos" });
  }
});

// Subir adjunto individual - MISMO NOMBRE PARA FRONTEND
router.post("/:id/adjuntos", async (req, res) => {
  try {
    const { id } = req.params;
    const { adjunto, index, total } = req.body;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!adjunto || typeof index === 'undefined' || !total) {
      return res.status(400).json({
        error: "Faltan campos: adjunto, index o total"
      });
    }

    // Verificar que la respuesta existe
    const respuestaExistente = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    if (!respuestaExistente) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    // Crear el objeto adjunto con el formato específico
    const adjuntoNormalizado = {
      pregunta: adjunto.pregunta || "Adjuntar documento aquí",
      fileName: normalizeFilename(adjunto.fileName),
      fileData: adjunto.fileData,
      mimeType: adjunto.mimeType || 'application/pdf',
      size: adjunto.size || 0,
      uploadedAt: new Date().toISOString()
    };


    // Buscar el documento de adjuntos
    const documentoAdjuntos = await req.db.collection("adjuntos").findOne({
      responseId: new ObjectId(id)
    });

    if (!documentoAdjuntos) {
      // Si no existe, crear uno nuevo con el formato específico
      const nuevoDocumento = {
        responseId: new ObjectId(id),
        submittedAt: new Date().toISOString(),
        adjuntos: [adjuntoNormalizado]
      };

      await req.db.collection("adjuntos").insertOne(nuevoDocumento);
      console.log(`Creado nuevo documento con primer adjunto`);
    } else {
      // Si existe, agregar al array manteniendo el formato
      await req.db.collection("adjuntos").updateOne(
        { responseId: new ObjectId(id) },
        {
          $push: { adjuntos: adjuntoNormalizado }
        }
      );
    }

    res.json({
      success: true,
      message: `Adjunto ${index + 1} de ${total} subido exitosamente`,
      fileName: adjuntoNormalizado.fileName
    });

  } catch (error) {
    console.error('Error subiendo adjunto individual:', error);
    res.status(500).json({
      error: `Error subiendo adjunto: ${error.message}`
    });
  }
});

// Obtiener y descargar un adjunto específico
router.get("/:id/adjuntos/:index", async (req, res) => {
  try {
    const { id, index } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });


    let query = {};

    if (ObjectId.isValid(id)) {
      query.responseId = new ObjectId(id);
    } else {
      return res.status(400).json({ error: "ID de respuesta inválido" });
    }

    const documentoAdjunto = await req.db.collection("adjuntos").findOne(query);

    if (!documentoAdjunto) {
      return res.status(404).json({ error: "Archivo adjunto no encontrado" });
    }

    let archivoAdjunto;

    if (documentoAdjunto.adjuntos && documentoAdjunto.adjuntos.length > 0) {
      archivoAdjunto = documentoAdjunto.adjuntos[parseInt(index)];
    } else if (documentoAdjunto.fileData) {
      archivoAdjunto = documentoAdjunto;
    } else {
      return res.status(404).json({ error: "Estructura de archivo no válida" });
    }

    if (!archivoAdjunto.fileData) {
      return res.status(404).json({ error: "Datos de archivo no disponibles" });
    }

    // Extraer datos base64
    const base64Data = archivoAdjunto.fileData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Configurar headers para descarga
    res.set({
      'Content-Type': archivoAdjunto.mimeType || 'application/pdf',
      'Content-Disposition': `attachment; filename="${archivoAdjunto.fileName}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache'
    });

    res.send(buffer);

  } catch (err) {
    console.error("Error descargando archivo adjunto:", err);
    res.status(500).json({ error: "Error descargando archivo adjunto: " + err.message });
  }
});

// Obtener todas las respuestas
router.get("/", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const answers = await req.db.collection("respuestas").find().toArray();

    // Importar decrypt
    const { decrypt } = require('../utils/seguridad.helper');

    // Descifrar cada respuesta
    const answersDescifradas = answers.map(answer => {
      const descifrarCampo = (valor) => {
        // Regex estricto para: iv(24):authTag(32):content
        const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;

        if (typeof valor === 'string' && encryptedRegex.test(valor)) {
          try {
            return decrypt(valor);
          } catch (e) { return valor; }
        }
        return valor;
      };



      const descifrarObjeto = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;

        if (Array.isArray(obj)) {
          return obj.map(item => {
            if (typeof item === 'string') return descifrarCampo(item);
            if (typeof item === 'object') return descifrarObjeto(item);
            return item;
          });
        }

        const resultado = {};
        for (const key in obj) {
          const valor = obj[key];
          if (typeof valor === 'string') {
            resultado[key] = descifrarCampo(valor);
          } else if (typeof valor === 'object') {
            resultado[key] = descifrarObjeto(valor);
          } else {
            resultado[key] = valor;
          }
        }
        return resultado;
      };

      const answerDescifrado = { ...answer };

      if (answerDescifrado.user) {
        answerDescifrado.user = descifrarObjeto(answerDescifrado.user);
      }

      if (answerDescifrado.responses) {
        answerDescifrado.responses = descifrarObjeto(answerDescifrado.responses);
      }

      return answerDescifrado;
    });

    res.json(answersDescifradas);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener formularios" });
  }
});

// Obtener respuestas por email
router.get("/mail/:mail", async (req, res) => {
  try {
    const cleanMail = req.params.mail.toLowerCase().trim();

    // 1. Buscar usuario por Blind Index (el mail está cifrado en la BD)
    const user = await req.db.collection("usuarios").findOne({
      mail_index: createBlindIndex(cleanMail)
    });

    if (!user) {
      return res.status(404).json({
        error: "Usuario no encontrado",
        mailBuscado: cleanMail
      });
    }

    const userIdString = user._id.toString();

    // Descifrar el nombre del usuario para la respuesta
    let nombreUsuario = "Usuario";
    if (user.nombre && user.nombre.includes(':')) {
      try {
        nombreUsuario = decrypt(user.nombre);
      } catch (decryptError) {
        console.error("Error descifrando nombre:", decryptError);
      }
    }

    // 2. Traer todas las respuestas para filtrar en memoria (debido a la encriptación del UID)
    const allAnswers = await req.db.collection("respuestas").find({}).toArray();

    const answers = allAnswers.filter(answer => {
      if (!answer.user) return false;

      // --- Lógica para Solicitudes Propias ---
      let isOwner = false;
      if (answer.user.uid) {
        let uidToCheck = answer.user.uid;
        // Si el UID está encriptado, lo desencriptamos para comparar
        if (typeof uidToCheck === 'string' && uidToCheck.includes(':')) {
          try {
            uidToCheck = decrypt(uidToCheck);
          } catch (e) {
            return false;
          }
        }
        isOwner = uidToCheck === userIdString;
      }

      // --- Lógica para Solicitudes Compartidas ---
      // Verificamos si el ID del usuario está en el array 'compartidos' dentro del objeto 'user'
      let isShared = false;
      if (answer.user.compartidos && Array.isArray(answer.user.compartidos)) {
        isShared = answer.user.compartidos.includes(userIdString);
      }

      return isOwner || isShared;
    });

    // --- Helpers de Desencriptación ---
    const descifrarCampo = (valor) => {
      const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;
      if (typeof valor === 'string' && encryptedRegex.test(valor)) {
        try {
          return decrypt(valor);
        } catch (error) {
          return valor;
        }
      }
      return valor;
    };

    const descifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(item => descifrarCampo(item));

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];
        if (typeof valor === 'string') {
          resultado[key] = descifrarCampo(valor);
        } else if (typeof valor === 'object' && valor !== null) {
          resultado[key] = descifrarObjeto(valor);
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // 3. Procesar y Desencriptar cada respuesta
    const answersProcessed = answers.map(answer => {
      const answerDescifrada = { ...answer };

      // Desencriptar estructuras principales
      if (answerDescifrada.user) answerDescifrada.user = descifrarObjeto(answerDescifrada.user);
      if (answerDescifrada.responses) answerDescifrada.responses = descifrarObjeto(answerDescifrada.responses);

      // Extraer trabajador de los responses descifrados
      let trabajador = "No especificado";
      if (answerDescifrada.responses) {
        trabajador = answerDescifrada.responses["Nombre del trabajador"] ||
          answerDescifrada.responses["NOMBRE DEL TRABAJADOR"] ||
          answerDescifrada.responses["Nombre del solicitante responsable de la empresa"] ||
          "No especificado";
      }

      // Determinar si es compartida comparando el UID original descifrado con el ID del solicitante
      // Si el UID no coincide con el usuario que consulta, es porque le fue compartida
      const esCompartida = answerDescifrada.user?.uid !== userIdString;

      return {
        _id: answerDescifrada._id,
        formId: answerDescifrada.formId,
        formTitle: answerDescifrada.formTitle,
        trabajador: trabajador,
        user: answerDescifrada.user,
        status: answerDescifrada.status,
        createdAt: answerDescifrada.createdAt,
        updatedAt: answerDescifrada.updatedAt,
        compartida: esCompartida, // TAG SOLICITADO
        isShared: esCompartida,    // Alias para compatibilidad
        metadata: {
          esPropia: !esCompartida
        },
        // Placeholder for form data, to be populated below
        form: null
      };
    });

    // --- OPTIMIZACIÓN: BUSCAR DATOS DE FORMULARIOS DEL SERVIDOR (LOOKUP) ---
    // Recolectar IDs únicos de formularios
    const formIds = [...new Set(answersProcessed.map(a => a.formId).filter(id => id))];

    // Buscar detalles de formularios
    const formsDetails = await req.db.collection("forms").find({
      _id: { $in: formIds.map(id => new ObjectId(id)) } // Asumiendo que formId es string de ObjectId
    }).project({
      title: 1,
      icon: 1,
      primaryColor: 1,
      section: 1,
      description: 1, // Útil para mostrar detalles
      updatedAt: 1
    }).toArray();

    // Crear mapa para acceso rápido
    const formsMap = new Map();
    formsDetails.forEach(f => formsMap.set(f._id.toString(), f));

    // Inyectar datos del formulario en cada respuesta
    answersProcessed.forEach(answer => {
      if (answer.formId && formsMap.has(answer.formId)) {
        const formData = formsMap.get(answer.formId);
        answer.form = {
          _id: formData._id,
          title: formData.title,
          icon: formData.icon,
          primaryColor: formData.primaryColor,
          section: formData.section,
          description: formData.description,
          updatedAt: formData.updatedAt
        };

        // Si no tiene título propio la respuesta, usar el del formulario
        if (!answer.formTitle) {
          answer.formTitle = formData.title;
        }
      }
    });
    // -----------------------------------------------------------------------

    // Ordenar por fecha (más recientes primero)
    answersProcessed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      usuario: nombreUsuario,
      mail: cleanMail,
      total: answersProcessed.length,
      respuestas: answersProcessed
    });

  } catch (err) {
    console.error("Error en GET /mail/:mail:", err);
    res.status(500).json({
      success: false,
      error: "Error al procesar la solicitud de formularios compartidos."
    });
  }
});

// Obtener respuestas en formato mini
// Obtener respuestas en formato mini con PAGINACIÓN
router.get("/mini", async (req, res) => {
  try {
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    // Obtener parámetros de query
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const collection = req.db.collection("respuestas");

    // Ejecutamos la cuenta total y la búsqueda en paralelo para mayor velocidad
    const [answers, totalCount, statusCounts] = await Promise.all([
      collection.find({})
        .sort({ createdAt: -1 }) // Importante: traer los más nuevos primero
        .skip(skip)
        .limit(limit)
        .project({
          _id: 1,
          formId: 1,
          formTitle: 1,
          "responses": 1,
          submittedAt: 1,
          "user.nombre": 1,
          "user.empresa": 1,
          status: 1,
          createdAt: 1,
          adjuntosCount: 1
        })
        .toArray(),
      collection.countDocuments({}),
      collection.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } }
      ]).toArray()
    ]);


    const { decrypt } = require('../utils/seguridad.helper');

    const answersProcessed = answers.map(answer => {
      // Helper para descifrar campos de respuestas (reutilizando tu lógica)
      const getDecryptedResponse = (keys) => {
        for (let key of keys) {
          if (answer.responses && answer.responses[key]) {
            try {
              return decrypt(answer.responses[key]);
            } catch (e) { return answer.responses[key]; }
          }
        }
        return "No especificado";
      };

      const trabajador = getDecryptedResponse([
        "Nombre del trabajador", "NOMBRE DEL TRABAJADOR", "nombre del trabajador",
        "Nombre del Trabajador", "Nombre Del trabajador "
      ]);

      const rutTrabajador = getDecryptedResponse([
        "RUT del trabajador", "RUT DEL TRABAJADOR", "rut del trabajador",
        "Rut del Trabajador", "Rut Del trabajador "
      ]);

      return {
        _id: answer._id,
        formId: answer.formId,
        formTitle: answer.formTitle,
        trabajador: trabajador,
        rutTrabajador: rutTrabajador,
        submittedAt: answer.submittedAt,
        user: answer.user ? {
          nombre: decrypt(answer.user.nombre),
          empresa: decrypt(answer.user.empresa)
        } : answer.user,
        status: answer.status,
        createdAt: answer.createdAt,
        adjuntosCount: answer.adjuntosCount || 0
      };
    });

    res.json({
      success: true,
      data: answersProcessed,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      stats: {
        total: totalCount,
        pending: statusCounts.find(s => s._id === 'pendiente')?.count || 0,
        inReview: statusCounts.find(s => s._id === 'en_revision')?.count || 0,
        approved: statusCounts.find(s => s._id === 'aprobado')?.count || 0,
        rejected: statusCounts.find(s => s._id === 'firmado')?.count || 0,
        finalized: statusCounts.find(s => s._id === 'finalizado')?.count || 0,
        archived: statusCounts.find(s => s._id === 'archivado')?.count || 0
      }
    });
  } catch (err) {
    console.error("Error en /mini:", err);
    res.status(500).json({ error: "Error al obtener formularios" });
  }
});

// ruta mini mejorada con capacidad de filtros 

router.get("/filtros", async (req, res) => {
  try {
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    // 1. Parámetros de la URL
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const { status, company, search, startDate, endDate } = req.query;

    // 2. Query inicial de Base de Datos (Campos no encriptados)
    let query = {};

    if (status && status !== "") {
      query["status"] = status;
    } else {
      query["status"] = { $ne: "archivado" };
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const collection = req.db.collection("respuestas");

    // 3. Obtenemos todos los registros que cumplen los filtros base de la DB
    // No limitamos aquí porque necesitamos desencriptar para buscar por 'search'
    const answers = await collection.find(query)
      .sort({ createdAt: -1 })
      .toArray();

    // 4. Procesamiento, Desencriptación y Mapeo
    let answersProcessed = answers.map(answer => {

      const getDecryptedResponse = (possibleKeys) => {
        if (!answer.responses) return "No especificado";
        const existingKey = possibleKeys.find(key => answer.responses[key] !== undefined);
        if (existingKey) {
          try {
            return decrypt(answer.responses[existingKey]);
          } catch (e) {
            return answer.responses[existingKey];
          }
        }
        return "No especificado";
      };

      const safeDecrypt = (val) => {
        if (!val) return "";
        try { return decrypt(val); } catch (e) { return val; }
      };

      // Extraemos los datos clave para la búsqueda y la respuesta
      const trabajador = getDecryptedResponse([
        "Nombre del trabajador",
        "NOMBRE DEL TRABAJADOR",
        "Nombre del Trabajador",
        "Nombre del solicitante responsable de la empresa"
      ]);

      const rutTrabajador = getDecryptedResponse([
        "RUT del trabajador",
        "RUT DEL TRABAJADOR",
        "Rut del Trabajador",
        "rut"
      ]);

      const nombreUsuario = safeDecrypt(answer.user?.nombre);
      const empresaUsuario = safeDecrypt(answer.user?.empresa);

      return {
        _id: answer._id,
        formId: answer.formId,
        formTitle: answer.formTitle || 'Sin Título',
        trabajador: trabajador,
        rutTrabajador: rutTrabajador,
        submittedAt: answer.submittedAt,
        status: answer.status,
        createdAt: answer.createdAt,
        adjuntosCount: answer.adjuntosCount || 0,
        submittedBy: nombreUsuario || 'Usuario Desconocido',
        company: empresaUsuario || 'Empresa Desconocida',
        user: {
          nombre: nombreUsuario,
          empresa: empresaUsuario
        }
      };
    });

    // 5. Filtrado en Memoria (Búsqueda por texto claro)
    if (search && search.trim() !== "") {
      const searchTerm = search.toLowerCase();
      answersProcessed = answersProcessed.filter(item => {
        return (
          item.trabajador.toLowerCase().includes(searchTerm) ||
          item.formTitle.toLowerCase().includes(searchTerm) ||
          item.submittedBy.toLowerCase().includes(searchTerm) ||
          item.company.toLowerCase().includes(searchTerm) ||
          item.rutTrabajador.toLowerCase().includes(searchTerm)
        );
      });
    }

    // 6. Filtro por empresa (Si el campo empresa también está encriptado en DB)
    if (company && company.trim() !== "") {
      const compTerm = company.toLowerCase();
      answersProcessed = answersProcessed.filter(item =>
        item.company.toLowerCase().includes(compTerm)
      );
    }

    // 7. Paginación manual tras el filtrado
    const totalCount = answersProcessed.length;
    const skip = (page - 1) * limit;
    const paginatedData = answersProcessed.slice(skip, skip + limit);

    // 8. Stats de estados (Basados en el universo filtrado por fecha/status de DB)
    // Para que los stats sean precisos, los calculamos del array procesado
    const stats = {
      total: totalCount,
      pendiente: answersProcessed.filter(a => a.status === 'pendiente').length,
      en_revision: answersProcessed.filter(a => a.status === 'en_revision').length,
      aprobado: answersProcessed.filter(a => a.status === 'aprobado').length,
      finalizado: answersProcessed.filter(a => a.status === 'finalizado').length,
      archivado: answersProcessed.filter(a => a.status === 'archivado').length,
      firmado: answersProcessed.filter(a => a.status === 'firmado').length
    };

    // 9. Respuesta final
    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        total: totalCount,
        page: page,
        limit: limit,
        totalPages: Math.ceil(totalCount / limit)
      },
      stats: stats
    });

  } catch (err) {
    console.error("Error crítico en /filtros:", err);
    res.status(500).json({
      success: false,
      error: "Error interno al procesar los filtros de búsqueda"
    });
  }
});

// ruta para compartir solicitudes con usuarios 
router.post("/compartir/", async (req, res) => {
  try {

    const { usuarios, id } = req.body;
    const responseId = id;

    await verifyRequest(req);

    // Validar que el array de usuarios exista
    if (!usuarios || !Array.isArray(usuarios)) {
      return res.status(400).json({
        success: false,
        message: "Se requiere un array de IDs de usuarios (usuariosIds)."
      });
    }

    // 2. Actualización en la colección 'respuestas'
    // Usamos la notación de punto para insertar 'compartidos' dentro del objeto 'user'
    const result = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(responseId) },
      {
        $set: {
          "user.compartidos": usuarios
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "La solicitud (respuesta) no fue encontrada."
      });
    }

    // 3. Respuesta exitosa
    res.json({
      success: true,
      message: "Solicitud compartida correctamente con los compañeros."
    });

  } catch (err) {
    console.error("Error en endpoint compartir:", err);
    // Si verifyRequest lanza un error con status, lo capturamos aquí
    if (err.status) return res.status(err.status).json({ message: err.message });

    res.status(500).json({
      success: false,
      error: "Error interno al procesar la acción de compartir."
    });
  }
});

// Obtener respuesta por ID - Versión simplificada
router.get("/:id", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const respuesta = await req.db.collection("respuestas")
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!respuesta) return res.status(404).json({ error: "Formulario no encontrado" });

    // Importar decrypt
    const { decrypt } = require('../utils/seguridad.helper');

    // Función simple para manejar campos cifrados/descifrados
    const procesarCampo = (valor) => {
      // Regex estricto para: iv(24):authTag(32):content
      const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;

      if (typeof valor === 'string' && encryptedRegex.test(valor)) {
        try {
          return decrypt(valor);
        } catch (error) {
          console.warn("Campo con formato cifrado pero error al descifrar");
          return valor; // Mantener original
        }
      }
      return valor;
    };

    // Procesar la respuesta
    const respuestaProcesada = { ...respuesta };

    // Procesar user
    if (respuestaProcesada.user) {
      const userProcesado = {};
      for (const key in respuestaProcesada.user) {
        userProcesado[key] = procesarCampo(respuestaProcesada.user[key]);
      }
      respuestaProcesada.user = userProcesado;
    }

    // Procesar responses (recursivo simple)
    const procesarResponses = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => procesarCampo(item));
      }

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];

        if (typeof valor === 'string') {
          resultado[key] = procesarCampo(valor);
        } else if (typeof valor === 'object' && valor !== null) {
          resultado[key] = procesarResponses(valor);
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    if (respuestaProcesada.responses) {
      respuestaProcesada.responses = procesarResponses(respuestaProcesada.responses);
    }

    res.json(respuestaProcesada);

  } catch (err) {
    res.status(500).json({ error: "Error al obtener formulario: " + err.message });
  }
});

//actualizar respuesta
router.put("/:id", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const { user, responses, ...rest } = req.body;

    // Preparar objeto de actualización
    const updateData = {
      ...rest,
      updatedAt: new Date().toISOString()
    };

    // Función para cifrar objetos recursivamente
    const cifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => {
          if (typeof item === 'string' && item.trim() !== '' && !item.includes(':')) {
            return encrypt(item);
          } else if (typeof item === 'object' && item !== null) {
            return cifrarObjeto(item);
          }
          return item;
        });
      }

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];

        if (typeof valor === 'string' && valor.trim() !== '' && !valor.includes(':')) {
          // Cifrar strings que no estén ya cifrados
          resultado[key] = encrypt(valor);
        } else if (typeof valor === 'object' && valor !== null) {
          resultado[key] = cifrarObjeto(valor);
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // 1. Si viene 'user' en la actualización, CIFRARLO antes de guardar
    if (user && typeof user === 'object') {
      updateData.user = cifrarObjeto(user);
    }

    // 2. Si viene 'responses' en la actualización, CIFRARLO antes de guardar
    if (responses && typeof responses === 'object') {
      updateData.responses = cifrarObjeto(responses);
    }


    // Actualizar en la base de datos
    const result = await req.db.collection("respuestas").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({ error: "Formulario no encontrado" });
    }

    console.log("Respuesta actualizada exitosamente");

    // Función para descifrar para la respuesta al frontend
    const descifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => {
          // Regex estricto
          const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;

          if (typeof item === 'string' && encryptedRegex.test(item)) {
            try {
              return decrypt(item);
            } catch (error) {
              console.error("Error descifrando array item:", error);
              return item;
            }
          } else if (typeof item === 'object' && item !== null) {
            return descifrarObjeto(item);
          }
          return item;
        });
      }

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];
        const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;

        if (typeof valor === 'string' && encryptedRegex.test(valor)) {
          try {
            resultado[key] = decrypt(valor);
          } catch (error) {
            console.error(`Error descifrando campo ${key}:`, error);
            resultado[key] = valor; // Mantener cifrado si hay error
          }
        } else if (typeof valor === 'object' && valor !== null) {
          resultado[key] = descifrarObjeto(valor);
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // Preparar respuesta DESCIFRADA para el frontend
    const respuestaActualizada = { ...result.value };

    // Descifrar user si está cifrado
    if (respuestaActualizada.user && typeof respuestaActualizada.user === 'object') {
      respuestaActualizada.user = descifrarObjeto(respuestaActualizada.user);
    }

    // Descifrar responses si están cifrados
    if (respuestaActualizada.responses && typeof respuestaActualizada.responses === 'object') {
      respuestaActualizada.responses = descifrarObjeto(respuestaActualizada.responses);
    }

    // Descifrar otros campos cifrados si existen
    if (respuestaActualizada.mail && respuestaActualizada.mail.includes(':')) {
      respuestaActualizada.mail = decrypt(respuestaActualizada.mail);
    }

    res.json({
      success: true,
      message: "Respuesta actualizada exitosamente",
      data: respuestaActualizada,
      metadata: {
        actualizadoEl: new Date().toISOString(),
        camposActualizados: Object.keys(updateData).filter(k => k !== 'updatedAt'),
        userActualizado: !!user,
        responsesActualizado: !!responses
      }
    });

  } catch (err) {
    console.error("Error actualizando respuesta PQC:", err);
    res.status(500).json({
      error: "Error al actualizar formulario: " + err.message,
      step: "actualizacion_pqc"
    });
  }
});

// Obtener respuestas por sección
router.get("/section/:section", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const forms = await req.db
      .collection("respuestas")
      .find({ section: req.params.section })
      .toArray();

    if (!forms.length)
      return res.status(404).json({ error: "No se encontraron formularios en esta sección" });

    res.status(200).json(forms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener formularios por sección" });
  }
});

//actualizar respuesta
router.put("/:id", async (req, res) => {
  try {
    const result = await req.db.collection("respuestas").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result.value) return res.status(404).json({ error: "Formulario no encontrado" });
    res.json(result.value);
  } catch (err) {
    res.status(500).json({ error: "Error al actualizar formulario" });
  }
});

//publicar formulario
router.put("/public/:id", async (req, res) => {
  try {
    const result = await req.db.collection("respuestas").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: "publicado",
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );

    if (!result.value)
      return res.status(404).json({ error: "Formulario no encontrado" });

    res.status(200).json(result.value);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al publicar formulario" });
  }
});

//eliminar respuesta
router.delete("/:id", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const responseId = req.params.id;

    // Eliminar de todas las colecciones relacionadas
    const [resultRespuestas, resultDocxs, resultAprobados, resultFirmados, resultAdjuntos] = await Promise.all([
      // Eliminar de respuestas
      req.db.collection("respuestas").deleteOne({ _id: new ObjectId(responseId) }),

      // Eliminar de docxs (si existe)
      req.db.collection("docxs").deleteOne({ responseId: responseId }),

      // Eliminar de aprobados (si existe)
      req.db.collection("aprobados").deleteOne({ responseId: responseId }),

      // Eliminar de firmados (si existe)
      req.db.collection("firmados").deleteOne({ responseId: responseId }),

      // Eliminar adjuntos (si existen)
      req.db.collection("adjuntos").deleteOne({ responseId: new ObjectId(responseId) })
    ]);

    // Verificar si al menos se eliminó la respuesta principal
    if (resultRespuestas.deletedCount === 0) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    res.status(200).json({
      message: "Formulario y todos los datos relacionados eliminados",
      deleted: {
        respuestas: resultRespuestas.deletedCount,
        docxs: resultDocxs.deletedCount,
        aprobados: resultAprobados.deletedCount,
        firmados: resultFirmados.deletedCount,
        adjuntos: resultAdjuntos.deletedCount
      }
    });
  } catch (err) {
    console.error("Error eliminando respuesta y datos relacionados:", err);
    res.status(500).json({ error: "Error al eliminar formulario" });
  }
});

//solicitar de mensajes
router.get("/:formId/chat/admin", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const { formId } = req.params;

    let query;
    if (ObjectId.isValid(formId)) {
      query = { $or: [{ _id: new ObjectId(formId) }, { formId }] };
    } else {
      query = { formId };
    }

    const respuesta = await req.db
      .collection("respuestas")
      .findOne(query, { projection: { mensajes: 1 } });

    if (!respuesta) {
      return res.status(404).json({ error: "No se encontró la respuesta con ese formId o _id" });
    }

    res.json(respuesta.mensajes || []);
  } catch (err) {
    console.error("Error obteniendo chat:", err);
    res.status(500).json({ error: "Error al obtener chat" });
  }
});

//solicitar de mensajes generales
router.get("/:formId/chat/", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const { formId } = req.params;

    let query;
    if (ObjectId.isValid(formId)) {
      query = { $or: [{ _id: new ObjectId(formId) }, { formId }] };
    } else {
      query = { formId };
    }

    const respuesta = await req.db
      .collection("respuestas")
      .findOne(query, { projection: { mensajes: 1 } });

    if (!respuesta) {
      return res.status(404).json({ error: "No se encontró la respuesta con ese formId o _id" });
    }

    const todosLosMensajes = respuesta.mensajes || [];

    const mensajesGenerales = todosLosMensajes.filter(msg => !msg.admin);

    res.json(mensajesGenerales);

  } catch (err) {
    console.error("Error obteniendo chat general:", err);
    res.status(500).json({ error: "Error al obtener chat general" });
  }
});

//enviar mensaje
router.post("/chat", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const { formId, autor, mensaje, admin, sendToEmail } = req.body;
    if (!autor || !mensaje || !formId) return res.status(400).json({ error: "Faltan campos" });

    const nuevoMensaje = { autor, mensaje, leido: false, fecha: new Date(), admin: admin || false };

    let query = ObjectId.isValid(formId) ? { $or: [{ _id: new ObjectId(formId) }, { formId }] } : { formId };
    const respuesta = await req.db.collection("respuestas").findOne(query);
    if (!respuesta) return res.status(404).json({ error: "Respuesta no encontrada" });

    await req.db.collection("respuestas").updateOne({ _id: respuesta._id }, { $push: { mensajes: nuevoMensaje } });

    // ENVIAR CORREO SI ESTÁ MARCADO EL CHECKBOX Y NO ES MENSAJE DE ADMIN
    if (sendToEmail === true && admin !== true) {
      try {
        // OBTENER DATOS PARA EL CORREO
        let userEmail = null;
        let formName = "el formulario";
        let userName = autor;
        let respuestaId = respuesta._id.toString();

        // OBTENER EMAIL DEL USUARIO (CLIENTE) DESDE LA RESPUESTA
        if (respuesta.user && respuesta.user.mail) {
          userEmail = respuesta.user.mail;
          userName = respuesta.user.nombre || autor;
        }

        // OBTENER NOMBRE DEL FORMULARIO
        if (respuesta.formId) {
          const form = await req.db.collection("forms").findOne({
            _id: new ObjectId(respuesta.formId)
          });
          if (form && form.title) {
            formName = form.title;
          }
        } else if (respuesta._contexto && respuesta._contexto.formTitle) {
          formName = respuesta._contexto.formTitle;
        }

        // ENVIAR CORREO SI TENEMOS EMAIL
        if (userEmail) {
          const baseUrl = process.env.PORTAL_URL || "https://infodesa.vercel.app";
          const responseUrl = `${baseUrl}/preview?type=messages&id=${respuestaId}`;

          const emailHtml = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; }
          .button { 
              display: inline-block; 
              background-color: #4f46e5; 
              color: white !important;  /* ← ESTA ES LA LÍNEA CLAVE */
              padding: 12px 24px; 
              text-decoration: none; 
              border-radius: 6px; 
              font-weight: bold; 
              margin-top: 20px; 
              border: none;
              cursor: pointer;
              text-align: center;
          }
          .button:hover { 
              background-color: #4338ca; 
              color: white !important;
          }
          .message-box { background-color: #f0f9ff; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4f46e5; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
          .title { color: #1f2937; font-size: 20px; font-weight: bold; margin-bottom: 20px; }
          .hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
      </style>
  </head>
  <body>
      <div class="container">
          <div class="header">
              <h1>Acciona Centro de Negocios</h1>
          </div>
          <div class="content">
              <h2 class="title">Tienes un nuevo mensaje en la plataforma de Recursos Humanos</h2>
              
              <p>Estimado/a <strong>${userName}</strong>,</p>
              
              <div class="message-box">
                  <p><strong>Formulario:</strong> ${formName}</p>
                  <p><strong>Fecha y hora:</strong> ${new Date().toLocaleDateString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })}</p>
              </div>
              
              <p>Para ver los detalles de la solicitud y responder al mensaje, haz clic en el siguiente botón:</p>
              
              <div style="text-align: center; margin: 30px 0;">
                  <a href="${responseUrl}" class="button" style="color: white !important; text-decoration: none;">
                      Ver detalles de la solicitud
                  </a>
              </div>
              
              <div class="hr"></div>
              
              <p style="font-size: 14px; color: #6b7280;">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
                  <a href="${responseUrl}" style="color: #4f46e5; word-break: break-all;">${responseUrl}</a>
              </p>
              
              <div class="footer">
                  <p>Este es un mensaje automático de la plataforma de Recursos Humanos de Acciona Centro de Negocios.</p>
                  <p>Una vez en la plataforma, puedes acceder a los mensajes desde la sección de chat.</p>
                  <p>Por favor, no responder a este correo.</p>
                  <p>© ${new Date().getFullYear()} Acciona Centro de Negocios Spa.</p>
              </div>
          </div>
      </div>
  </body>
  </html>
`;

          // USAR LA MISMA FUNCIÓN DE ENVÍO DE CORREOS QUE EN upload-corrected-files
          const { sendEmail } = require("../utils/mail.helper");

          await sendEmail({
            to: userEmail,
            subject: `Nuevo mensaje - Plataforma RRHH - ${formName}`,
            html: emailHtml
          });
        }
      } catch (emailError) {
        console.error("Error enviando correo:", emailError);
        // Continuamos aunque falle el correo, no afecta la respuesta del mensaje
      }
    }

    // NOTIFICACIONES (lógica original mantenida)
    if (respuesta?.user?.nombre === autor) {
      const notifChat = {
        filtro: { cargo: "RRHH" },
        titulo: "Nuevo mensaje en formulario",
        descripcion: `${autor} ha enviado un mensaje.`,
        icono: "MessageCircle", color: "#45577eff",
        actionUrl: `/RespuestasForms?id=${respuesta._id}`,
      };
      await addNotification(req.db, notifChat);
      await addNotification(req.db, { ...notifChat, filtro: { cargo: "admin" } });
    } else {
      await addNotification(req.db, {
        userId: respuesta.user.uid,
        titulo: "Nuevo mensaje recibido",
        descripcion: `${autor} le ha enviado un mensaje.`,
        icono: "MessageCircle", color: "#45577eff",
        actionUrl: `/?id=${respuesta._id}`,
      });
    }

    res.json({
      message: "Mensaje enviado",
      data: nuevoMensaje,
      emailSent: sendToEmail === true && admin !== true
    });
  } catch (err) {
    console.error("Error en chat:", err);
    res.status(500).json({ error: "Error en chat" });
  }
});

// Marcar todos los mensajes como leídos
router.put("/chat/marcar-leidos", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const result = await req.db.collection("respuestas").updateMany(
      { "mensajes.leido": false },
      { $set: { "mensajes.$[].leido": true } }
    );

    res.json({
      message: "Todos los mensajes fueron marcados como leídos",
      result,
    });
  } catch (err) {
    console.error("Error al marcar mensajes como leídos:", err);
    res.status(500).json({ error: "Error al marcar mensajes como leídos" });
  }
});

// Subir corrección PDF (se mantiene por compatibilidad)
router.post("/:id/upload-correction", upload.single('correctedFile'), async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!req.file) return res.status(400).json({ error: "No se subió ningún archivo" });

    const respuesta = await req.db.collection("respuestas").findOne({ _id: new ObjectId(req.params.id) });
    if (!respuesta) return res.status(404).json({ error: "Respuesta no encontrada" });

    // Buscar usuario por el UID guardado en la respuesta
    const user = await req.db.collection("usuarios").findOne({ _id: new ObjectId(respuesta.user.uid) });

    const normalizedFileName = normalizeFilename(req.file.originalname);

    const result = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          hasCorrection: true,
          correctionFileName: normalizedFileName,
          fileData: req.file.buffer, // Considerar cifrar aquí si el PDF es sensible
          updatedAt: new Date()
        }
      }
    );

    if (user) {
      const userNombre = decrypt(user.nombre);
      const userMail = decrypt(user.mail);

      const htmlContent = `
          <div style="font-family: sans-serif; color: #333;">
              <h2 style="color: #f97316;">Nueva Corrección Disponible</h2>
              <p>Hola <strong>${userNombre}</strong>,</p>
              <p>Se ha subido una corrección para: <strong>${respuesta.formTitle}</strong>.</p>
              <p>Archivo: ${normalizedFileName}</p>
              <p>Saludos, Equipo Acciona</p>
          </div>`;

      try {
        await sendEmail({ to: userMail, subject: 'Notificación de Corrección', html: htmlContent });
      } catch (e) { console.error("Error mail:", e); }
    }

    res.json({ success: true, message: "Corrección subida", fileName: normalizedFileName });
  } catch (err) {
    res.status(500).json({ error: "Error subiendo corrección" });
  }
});

// Cambiar estado a finalizado
router.get("/:id/finalized", async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID de respuesta inválido" });
    }

    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "finalizado",
          finalizedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "No se pudo actualizar la respuesta" });
    }


    res.json({
      success: true,
      message: "Respuesta finalizada correctamente",
      status: "finalizado",
      responseId: id
    });

  } catch (err) {
    console.error("Error finalizando respuesta:", err);
    res.status(500).json({ error: "Error finalizando respuesta: " + err.message });
  }
});

// Endpoint de mantenimiento único para limpiar archivos de respuestas ya archivadas
router.get("/mantenimiento/limpiar-archivos-archivados", async (req, res) => {
  try {
    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    // 1. Buscar todas las respuestas que ya están en estado "archivado"
    const respuestasArchivadas = await req.db
      .collection("respuestas")
      .find({ status: "archivado" }, { projection: { _id: 1 } })
      .toArray();

    if (respuestasArchivadas.length === 0) {
      return res.json({
        success: true,
        message: "No se encontraron respuestas archivadas para limpiar.",
        stats: { aprobados: 0, adjuntos: 0, docxs: 0 }
      });
    }

    // 2. Extraer los IDs en formato String y ObjectId
    const idsString = respuestasArchivadas.map(r => r._id.toString());
    const idsObjectId = respuestasArchivadas.map(r => r._id);

    // 3. Ejecutar la eliminación masiva en las colecciones de archivos
    // Usamos $in para borrar todos los documentos cuyos responseId coincidan con la lista
    const [delAprobados, delAdjuntos, delDocxs] = await Promise.all([
      req.db.collection("aprobados").deleteMany({
        responseId: { $in: idsString }
      }),
      req.db.collection("adjuntos").deleteMany({
        responseId: { $in: idsObjectId }
      }),
      req.db.collection("docxs").deleteMany({
        responseId: { $in: idsString }
      })
    ]);

    const stats = {
      respuestasProcesadas: respuestasArchivadas.length,
      documentosEliminados: {
        aprobados: delAprobados.deletedCount,
        adjuntos: delAdjuntos.deletedCount,
        docxs: delDocxs.deletedCount
      }
    };


    res.json({
      success: true,
      message: "Limpieza de histórico completada con éxito",
      stats
    });

  } catch (err) {
    console.error("Error en la limpieza masiva de archivos:", err);
    res.status(500).json({
      error: "Error durante el proceso de limpieza: " + err.message
    });
  }
});

// Cambiar estado a archivado
router.get("/:id/archived", async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID de respuesta inválido" });
    }

    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    // 1. Actualizar el estado a archivado
    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: "archivado",
          archivedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "No se pudo actualizar la respuesta" });
    }

    const cleanupResults = await Promise.all([
      // Eliminar de aprobados (usa responseId como string u objeto según tu flujo)
      req.db.collection("aprobados").deleteMany({ responseId: id }),

      // Eliminar de adjuntos (suele usar ObjectId por la estructura anterior)
      req.db.collection("adjuntos").deleteMany({ responseId: new ObjectId(id) }),

      // Eliminar de docxs (usa responseId habitualmente como string)
      req.db.collection("docxs").deleteMany({ responseId: id })
    ]);



    // Respuesta final al cliente
    res.json({
      success: true,
      message: "Respuesta archivada y archivos relacionados eliminados correctamente",
      status: "archivado",
      responseId: id,
      cleanup: {
        aprobados: cleanupResults[0].deletedCount,
        adjuntos: cleanupResults[1].deletedCount,
        docxs: cleanupResults[2].deletedCount
      }
    });

  } catch (err) {
    console.error("Error archivando respuesta y limpiando colecciones:", err);
    res.status(500).json({ error: "Error archivando respuesta: " + err.message });
  }
});

// Subir múltiples archivos corregidos
router.post("/upload-corrected-files", async (req, res) => {
  try {
    // Verificar token (antes de procesar uploads si es posible, o dentro del callback)
    // Nota: Como usamos uploadMultiple.array, multer procesa primero. 
    // Podríamos verificar el token dentro del callback, ya que req.body estará poblado ahí.



    uploadMultiple.array('files', 10)(req, res, async (err) => {
      if (err) {
        console.error("Error en uploadMultiple:", err);
        return res.status(400).json({ error: err.message });
      }

      // Verificar token AHORA que tenemos acceso a req y body (aunque body puede estar vacío si es form-data puro sin campos de texto previos)
      // Pero verifyRequest mira headers también.
      const auth = await verifyRequest(req);
      if (!auth.ok) return res.status(401).json({ error: auth.error });



      const { responseId, index, total } = req.body;
      const files = req.files;

      // VALIDACIONES MEJORADAS
      if (!responseId) {
        return res.status(400).json({ error: 'responseId es requerido' });
      }

      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({
          error: 'No se subió ningún archivo',
          filesReceived: files ? files.length : 0
        });
      }

      // OBTENER DATOS DEL USUARIO Y FORMULARIO
      let userEmail = null;
      let formName = "el formulario";
      let userName = "Usuario";
      let userId = null;

      try {
        // Buscar la respuesta en la base de datos
        const response = await req.db.collection("respuestas").findOne({
          _id: new ObjectId(responseId)
        });

        if (response) {
          // OBTENER EMAIL Y NOMBRE DEL USUARIO DESDE LA RESPUESTA
          // El email está en texto plano en response.user.mail
          if (response.user && response.user.mail) {
            userEmail = response.user.mail;
            userName = response.user.nombre || "Usuario";
            userId = response.user.uid;
          } else {
            console.log("No se encontró response.user.mail en la respuesta");
          }

          // OBTENER NOMBRE DEL FORMULARIO
          if (response.formId) {
            const form = await req.db.collection("forms").findOne({
              _id: new ObjectId(response.formId)
            });

            if (form && form.title) {
              formName = form.title;
            } else {
              // Fallback: usar formTitle del _contexto si existe
              if (response._contexto && response._contexto.formTitle) {
                formName = response._contexto.formTitle;
              }
            }
          } else if (response._contexto && response._contexto.formTitle) {
            // Si no hay formId, usar el del contexto
            formName = response._contexto.formTitle;

          }
        } else {
          console.log("No se encontró la respuesta");
        }
      } catch (userInfoError) {
        console.error("Error obteniendo información del usuario/formulario:", userInfoError);
      }

      // PROCESAR CADA ARCHIVO
      for (const file of files) {

        const correctedFile = {
          fileName: normalizeFilename(file.originalname),
          tipo: 'pdf',
          fileData: file.buffer,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedAt: new Date(),
          order: parseInt(index) + 1 || 1
        };

        // BUSCAR O CREAR DOCUMENTO EN LA DB
        const existingApproval = await req.db.collection("aprobados").findOne({
          responseId: responseId
        });

        if (existingApproval) {
          const result = await req.db.collection("aprobados").findOneAndUpdate(
            { responseId: responseId },
            {
              $push: { correctedFiles: correctedFile },
              $set: { updatedAt: new Date() }
            },
            { returnDocument: 'after' }
          );
        } else {
          await req.db.collection("aprobados").insertOne({
            responseId: responseId,
            correctedFiles: [correctedFile],
            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: null,
            approvedBy: null
          });
          console.log(`Nuevo documento creado en DB con 1 archivo`);
        }
      }

      // ENVIAR CORREO AL USUARIO DESPUÉS DE SUBIR A LA DB
      let emailSent = false;
      if (userEmail) {
        try {
          const { sendEmail } = require("../utils/mail.helper");
          const portalUrl = process.env.PORTAL_URL || "https://infoacciona.cl";
          const responseUrl = `${portalUrl}/preview?type=details&id=${responseId}`;


          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; }
                    .button { display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
                    .details { background-color: #f0f9ff; padding: 15px; border-radius: 6px; margin: 20px 0; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Acciona Centro de Negocios</h1>
                    </div>
                    <div class="content">
                        <h2>📄 Documentos aprobados disponibles</h2>
                        <p>Estimado/a <strong>${userName}</strong>,</p>
                        
                        <div class="details">
                            <p><strong>Formulario:</strong> ${formName}</p>
                            <p><strong>Fecha de recepción:</strong> ${new Date().toLocaleDateString('es-CL')}</p>
                            <p><strong>N° de respuesta:</strong> ${responseId}</p>
                        </div>
                        
                        <p>Se han cargado documentos aprobados correspondientes a tu respuesta. 
                        Ya puedes revisarlos y proceder con la firma digital.</p>
                        
                        <a href="${responseUrl}" class="button">
                            🔍 Ver documentos en el portal
                        </a>
                        
                        <p><small>O copia este enlace en tu navegador:<br>
                        ${responseUrl}</small></p>
                        
                        <div class="footer">
                            <p>Este es un mensaje automático. Si tienes dudas, contacta a tu ejecutivo.</p>
                            <p>© ${new Date().getFullYear()} Acciona Centro de Negocios Spa.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
          `;


          await sendEmail({
            to: userEmail,
            subject: `📄 Documentos aprobados disponibles - ${formName} - Acciona`,
            html: emailHtml
          });

          emailSent = true;

        } catch (emailError) {
          console.error("Error enviando correo:", emailError);
          // Continuamos aunque falle el correo
        }
      } else {
        console.log("No se pudo obtener el email del usuario, no se envía correo");
      }

      res.json({
        success: true,
        message: `Archivo(s) subido(s) exitosamente a la base de datos`,
        filesProcessed: files.length,
        emailSent: emailSent,
        uploadedToDB: true,
        userNotified: emailSent
      });
    });
  } catch (error) {
    console.error('Error completo:', error);
    res.status(500).json({
      error: `Error: ${error.message}`,
      uploadedToDB: false
    });
  }
});

// OBTENER TODOS LOS ARCHIVOS CORREGIDOS DE UNA RESPUESTA
router.get("/corrected-files/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    }, {
      projection: {
        correctedFiles: 1,
        formTitle: 1
      }
    });

    if (!approvedDoc || !approvedDoc.correctedFiles) {
      return res.json({
        correctedFiles: [],
        formTitle: null
      });
    }

    // Ordenar archivos por order si existe, sino por uploadedAt
    const sortedFiles = approvedDoc.correctedFiles.sort((a, b) => {
      if (a.order && b.order) return a.order - b.order;
      return new Date(a.uploadedAt) - new Date(b.uploadedAt);
    });

    // Retornar información sin los datos binarios
    const filesInfo = sortedFiles.map(file => ({
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      uploadedAt: file.uploadedAt,
      order: file.order || 1,
      tipo: file.tipo
    }));

    res.json({
      correctedFiles: filesInfo,
      formTitle: approvedDoc.formTitle,
      totalFiles: filesInfo.length
    });

  } catch (error) {
    console.error('Error obteniendo archivos corregidos:', error);
    res.status(500).json({ error: `Error obteniendo archivos: ${error.message}` });
  }
});

// DESCARGAR ARCHIVO CORREGIDO ESPECÍFICO
router.get("/download-corrected-file/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;
    const { fileName, index } = req.query;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    if (!approvedDoc || !approvedDoc.correctedFiles || approvedDoc.correctedFiles.length === 0) {
      return res.status(404).json({ error: "No se encontraron archivos corregidos" });
    }

    let file;

    if (fileName) {
      file = approvedDoc.correctedFiles.find(f => f.fileName === fileName);
    } else if (index !== undefined) {
      const fileIndex = parseInt(index);
      if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= approvedDoc.correctedFiles.length) {
        return res.status(400).json({ error: "Índice de archivo inválido" });
      }
      file = approvedDoc.correctedFiles[fileIndex];
    } else {
      return res.status(400).json({ error: "Se requiere fileName o index" });
    }

    if (!file) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    res.setHeader('Content-Type', file.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.fileSize);
    res.setHeader('Cache-Control', 'no-cache');

    res.send(file.fileData.buffer || file.fileData);

  } catch (err) {
    console.error("Error descargando archivo corregido:", err);
    res.status(500).json({ error: "Error descargando archivo: " + err.message });
  }
});

// ELIMINAR ARCHIVO CORREGIDO ESPECÍFICO
router.delete("/delete-corrected-file/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;
    const { fileName } = req.body;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!fileName) {
      return res.status(400).json({ error: "fileName es requerido" });
    }

    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    if (!approvedDoc || !approvedDoc.correctedFiles) {
      return res.status(404).json({ error: "No se encontraron archivos corregidos" });
    }

    const fileExists = approvedDoc.correctedFiles.some(f => f.fileName === fileName);
    if (!fileExists) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }

    // Guardar información del estado actual antes de eliminar
    const respuestaActual = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(responseId)
    });

    const estadoActual = respuestaActual?.status;
    const tieneFirma = await req.db.collection("firmados").findOne({
      responseId: responseId
    });

    // Eliminar el archivo específico del array
    const result = await req.db.collection("aprobados").updateOne(
      { responseId: responseId },
      {
        $pull: {
          correctedFiles: { fileName: fileName }
        },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: "No se pudo eliminar el archivo" });
    }

    // Verificar si quedan archivos después de eliminar
    const updatedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    // Si no quedan archivos, eliminar el documento completo y cambiar estado
    if (!updatedDoc.correctedFiles || updatedDoc.correctedFiles.length === 0) {
      await req.db.collection("aprobados").deleteOne({ responseId: responseId });

      // Determinar el nuevo estado
      let nuevoEstado = "en_revision";

      // Solo cambiar a 'en_revision' si actualmente está en 'aprobado' o 'firmado'
      // y NO hay firma existente
      if ((estadoActual === 'aprobado' || estadoActual === 'firmado') && !tieneFirma) {
        nuevoEstado = "en_revision";
      } else if (estadoActual === 'firmado' && tieneFirma) {
        // Si hay firma, mantener en 'firmado' pero sin correcciones
        nuevoEstado = "firmado";
      } else if (estadoActual === 'finalizado' || estadoActual === 'archivado') {
        // No cambiar estados finales
        nuevoEstado = estadoActual;
      }

      await req.db.collection("respuestas").updateOne(
        { _id: new ObjectId(responseId) },
        {
          $set: {
            hasCorrection: false,
            status: nuevoEstado,
            updatedAt: new Date()
          }
        }
      );

      // Enviar notificación si cambió el estado
      if (nuevoEstado === 'en_revision' && estadoActual !== 'en_revision') {
        await addNotification(req.db, {
          filtro: { cargo: "RRHH" },
          titulo: `Correcciones eliminadas - Volviendo a revisión`,
          descripcion: `Se eliminaron todas las correcciones del formulario ${respuestaActual?.formTitle}. El estado ha vuelto a 'en_revision'.`,
          prioridad: 2,
          icono: 'RefreshCw',
          color: '#ff9800',
          actionUrl: `/RespuestasForms?id=${responseId}`,
        });

        await addNotification(req.db, {
          userId: respuestaActual?.user?.uid,
          titulo: "Documento vuelve a revisión",
          descripcion: `Las correcciones del formulario ${respuestaActual?.formTitle} han sido eliminadas. El documento está nuevamente en revisión.`,
          prioridad: 2,
          icono: 'RefreshCw',
          color: '#ff9800',
          actionUrl: `/?id=${responseId}`,
        });
      }

      res.json({
        success: true,
        message: "Archivo eliminado exitosamente. No quedan archivos corregidos.",
        deletedFile: fileName,
        statusChanged: nuevoEstado !== estadoActual,
        newStatus: nuevoEstado,
        hadFiles: false
      });

    } else {
      // Si aún quedan archivos, solo actualizar la fecha
      await req.db.collection("respuestas").updateOne(
        { _id: new ObjectId(responseId) },
        {
          $set: {
            updatedAt: new Date()
          }
        }
      );

      res.json({
        success: true,
        message: "Archivo eliminado exitosamente",
        deletedFile: fileName,
        remainingFiles: updatedDoc.correctedFiles.length,
        hadFiles: true
      });
    }

  } catch (err) {
    console.error("Error eliminando archivo corregido:", err);
    res.status(500).json({ error: "Error eliminando archivo: " + err.message });
  }
});

// APROBAR FORMULARIO CON MÚLTIPLES ARCHIVOS (MODIFICADO)
router.post("/:id/approve", async (req, res) => {
  try {
    const responseId = req.params.id;

    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(responseId)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    // Verificar que existan archivos corregidos en la colección 'aprobados'
    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    if (!approvedDoc || !approvedDoc.correctedFiles || approvedDoc.correctedFiles.length === 0) {
      return res.status(400).json({
        error: "No hay archivos corregidos para aprobar. Debe subir al menos un archivo PDF primero."
      });
    }


    const existingSignature = await req.db.collection("firmados").findOne({
      responseId: responseId
    });

    let nuevoEstado = "aprobado";
    if (existingSignature) {
      console.log("Existe documento firmado, saltando directamente a estado 'firmado'");
      nuevoEstado = "firmado";
    }

    // Actualizar el documento en 'aprobados' con la información de aprobación
    await req.db.collection("aprobados").updateOne(
      { responseId: responseId },
      {
        $set: {
          approvedAt: new Date(),
          approvedBy: req.user?.id,
          updatedAt: new Date()
        }
      }
    );

    // Actualizar la respuesta principal
    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(responseId) },
      {
        $set: {
          status: nuevoEstado,
          approvedAt: new Date(),
          updatedAt: new Date()
        },
        $unset: {
          correctedFile: ""
        }
      }
    );

    // Enviar notificación al usuario
    await addNotification(req.db, {
      userId: respuesta.user?.uid,
      titulo: "Documento Aprobado",
      descripcion: `Se ha aprobado el documento asociado al formulario ${respuesta.formTitle} con ${approvedDoc.correctedFiles.length} archivo(s)`,
      prioridad: 2,
      icono: 'FileText',
      color: '#47db34ff',
      actionUrl: `/?id=${responseId}`,
    });

    res.json({
      message: existingSignature
        ? `Formulario aprobado y restaurado a estado firmado (existía firma previa) con ${approvedDoc.correctedFiles.length} archivo(s)`
        : `Formulario aprobado correctamente con ${approvedDoc.correctedFiles.length} archivo(s)`,
      approved: true,
      status: nuevoEstado,
      hadExistingSignature: !!existingSignature,
      totalFiles: approvedDoc.correctedFiles.length
    });

  } catch (err) {
    console.error("Error aprobando formulario:", err);
    res.status(500).json({ error: "Error aprobando formulario: " + err.message });
  }
});

// OBTENER DATOS DE ARCHIVOS APROBADOS (MODIFICADO)
router.get("/data-approved/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;


    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    if (!approvedDoc) {
      return res.status(404).json({ error: "Documento aprobado no encontrado" });
    }

    if (!approvedDoc.correctedFiles || approvedDoc.correctedFiles.length === 0) {
      return res.status(404).json({ error: "Archivos corregidos no disponibles" });
    }

    // Retornar información de todos los archivos
    const filesInfo = approvedDoc.correctedFiles.map(file => ({
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      uploadedAt: file.uploadedAt,
      order: file.order || 1,
      tipo: file.tipo
    }));

    const responseData = {
      correctedFiles: filesInfo,
      approvedAt: approvedDoc.approvedAt,
      formTitle: approvedDoc.formTitle,
      totalFiles: filesInfo.length
    };


    res.json(responseData);

  } catch (err) {
    console.error("Error obteniendo datos de archivos aprobados:", err);
    res.status(500).json({ error: "Error obteniendo datos de archivos aprobados: " + err.message });
  }
});

// DESCARGAR PDF APROBADO - CORREGIDO
router.get("/download-approved-pdf/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;
    const { index } = req.query;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });


    const approvedDoc = await req.db.collection("aprobados").findOne({
      responseId: responseId
    });

    if (!approvedDoc) {
      return res.status(404).json({ error: "Documento aprobado no encontrado" });
    }

    if (!approvedDoc.correctedFiles || approvedDoc.correctedFiles.length === 0) {
      return res.status(404).json({ error: "Archivos PDF no disponibles" });
    }

    let file;
    if (index !== undefined) {
      const fileIndex = parseInt(index);
      if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= approvedDoc.correctedFiles.length) {
        return res.status(400).json({ error: "Índice de archivo inválido" });
      }
      file = approvedDoc.correctedFiles[fileIndex];
    } else {
      file = approvedDoc.correctedFiles[0];
    }

    if (!file || !file.fileData) {
      return res.status(404).json({ error: "Archivo PDF no disponible" });
    }


    // CORREGIDO: Asegurar que fileName existe
    const fileName = file.fileName || `documento_aprobado_${responseId}.pdf`;

    res.setHeader('Content-Type', file.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', file.fileSize || (file.fileData.buffer ? file.fileData.buffer.length : file.fileData.length));
    res.setHeader('Cache-Control', 'no-cache');

    // Enviar los datos correctamente
    const fileBuffer = file.fileData.buffer || file.fileData;
    res.send(fileBuffer);


  } catch (err) {
    console.error("Error descargando PDF aprobado:", err);
    res.status(500).json({ error: "Error descargando PDF aprobado: " + err.message });
  }
});

// ELIMINAR CORRECCIÓN (MODIFICADO)
router.delete("/:id/remove-correction", async (req, res) => {
  try {
    const responseId = req.params.id;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });


    const existingSignature = await req.db.collection("firmados").findOne({
      responseId: responseId
    });

    const respuestaActual = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(responseId)
    });

    let nuevoEstado = "en_revision";

    // Determinar nuevo estado según si hay firma
    if (existingSignature) {
      nuevoEstado = "firmado";
      console.log("Existe documento firmado, manteniendo estado 'firmado'");
    } else if (respuestaActual?.status === 'finalizado' || respuestaActual?.status === 'archivado') {
      nuevoEstado = respuestaActual.status;
    }

    // Eliminar el documento completo de 'aprobados'
    const deleteResult = await req.db.collection("aprobados").deleteOne({
      responseId: responseId
    });


    // Actualizar la respuesta principal
    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(responseId) },
      {
        $set: {
          status: nuevoEstado,
          updatedAt: new Date()
        },
        $unset: {
          correctedFile: "",
          hasCorrection: ""
        }
      }
    );


    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    const updatedResponse = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(responseId)
    });

    res.json({
      message: "Corrección eliminada exitosamente",
      updatedRequest: updatedResponse,
      hasExistingSignature: !!existingSignature,
      deletedFiles: deleteResult.deletedCount > 0 ? "Todos los archivos fueron eliminados" : "No había archivos para eliminar",
      newStatus: nuevoEstado
    });

  } catch (err) {
    console.error("Error eliminando corrección:", err);
    res.status(500).json({ error: "Error eliminando corrección: " + err.message });
  }
});

// Subir PDF firmado por cliente a colección firmados y cambiar estado de respuesta a 'firmado'
router.post("/:responseId/upload-client-signature", upload.single('signedPdf'), async (req, res) => {
  try {
    const { responseId } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!req.file) {
      return res.status(400).json({ error: "No se subió ningún archivo" });
    }

    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(responseId)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Formulario no encontrado" });
    }

    const existingSignature = await req.db.collection("firmados").findOne({
      responseId: responseId
    });

    if (existingSignature) {
      return res.status(400).json({ error: "Ya existe un documento firmado para este formulario" });
    }

    const normalizedFileName = normalizeFilename(req.file.originalname);

    const signatureData = {
      fileName: normalizedFileName,
      fileData: req.file.buffer,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date(),
      signedBy: respuesta.responses['Nombre del trabajador'],
      clientName: respuesta.submittedBy || respuesta.user?.nombre,
      clientEmail: respuesta.userEmail || respuesta.user?.mail
    };

    const result = await req.db.collection("firmados").insertOne({
      responseId: responseId,
      formId: respuesta.formId,
      formTitle: respuesta.formTitle,
      clientSignedPdf: signatureData,
      status: "uploaded",
      uploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      company: respuesta.company
    });

    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(responseId) },
      {
        $set: {
          status: "firmado",
          signedAt: new Date()
        }
      }
    );

    await addNotification(req.db, {
      filtro: { cargo: "RRHH" },
      titulo: `Documento ${respuesta.formTitle} Firmado`,
      descripcion: `se ha recibido el Documento Firmado asociado al Formulario ${respuesta.formTitle} ${respuesta.responses['Nombre del trabajador']}`,
      prioridad: 2,
      icono: 'Pen',
      color: '#dbca34ff',
      actionUrl: `/RespuestasForms?id=${respuesta._id}`,
    });

    res.json({
      success: true,
      message: "Documento firmado subido exitosamente",
      signatureId: result.insertedId
    });

  } catch (err) {
    console.error("Error subiendo firma del cliente:", err);
    res.status(500).json({ error: "Error subiendo firma del cliente" });
  }
});

// Obtener PDF firmado por cliente SIN cambiar estado - CORREGIDO
router.get("/:responseId/client-signature", async (req, res) => {
  try {
    const { responseId } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });


    const signature = await req.db.collection("firmados").findOne({
      responseId: responseId
    });

    if (!signature) {
      return res.status(404).json({ error: "Documento firmado no encontrado" });
    }

    const pdfData = signature.clientSignedPdf;

    if (!pdfData || !pdfData.fileData) {
      return res.status(404).json({ error: "Archivo PDF no disponible" });
    }

    // Obtener el buffer de datos
    const fileBuffer = pdfData.fileData.buffer || pdfData.fileData;

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(404).json({ error: "Datos del archivo no disponibles" });
    }

    // CORREGIDO: Usar el fileName real, no el por defecto
    const fileName = pdfData.fileName || `documento_firmado_${responseId}.pdf`;
    const encodedFileName = encodeURIComponent(fileName);

    res.setHeader('Content-Type', pdfData.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFileName}`);
    res.setHeader('Content-Length', pdfData.fileSize || fileBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');


    res.send(fileBuffer);

  } catch (err) {
    console.error("Error descargando documento firmado:", err);
    res.status(500).json({
      error: "Error descargando documento firmado: " + err.message
    });
  }
});

// Eliminar PDF firmado por cliente y volver al estado 'aprobado'
router.delete("/:responseId/client-signature", async (req, res) => {
  try {
    const { responseId } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    const deleteResult = await req.db.collection("firmados").deleteOne({
      responseId: responseId
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Documento firmado no encontrado" });
    }

    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(responseId) },
      {
        $set: {
          status: "aprobado",
          updatedAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: "Documento firmado eliminado exitosamente"
    });

  } catch (err) {
    console.error("Error eliminando firma del cliente:", err);
    res.status(500).json({ error: "Error eliminando firma del cliente" });
  }
});

// Verificar si existe PDF firmado para una respuesta específica
router.get("/:responseId/has-client-signature", async (req, res) => {
  try {
    const { responseId } = req.params;

    const signature = await req.db.collection("firmados").findOne({
      responseId: responseId
    }, {
      projection: {
        "clientSignedPdf.fileName": 1,
        "clientSignedPdf.uploadedAt": 1,
        "clientSignedPdf.fileSize": 1,
        status: 1
      }
    });

    if (!signature) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      signature: {
        fileName: signature.clientSignedPdf.fileName,
        uploadedAt: signature.clientSignedPdf.uploadedAt,
        fileSize: signature.clientSignedPdf.fileSize,
        status: signature.status
      }
    });

  } catch (err) {
    console.error("Error verificando firma del cliente:", err);
    res.status(500).json({ error: "Error verificando documento firmado" });
  }
});

// Endpoint para regenerar documento desde respuestas existentes
router.post("/:id/regenerate-document", async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });


    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    const form = await req.db.collection("forms").findOne({
      _id: new ObjectId(respuesta.formId)
    });

    if (!form) {
      return res.status(404).json({ error: "Formulario original no encontrado" });
    }


    try {
      // Si el usuario en la respuesta tiene datos cifrados, descifrarlos
      let nombreUsuario = respuesta.user?.nombre;
      let empresaUsuario = respuesta.user?.empresa;
      let uidUsuario = respuesta.user?.uid;
      let mailUsuario = respuesta.user?.mail;

      // Intentar descifrar el nombre si parece estar cifrado
      if (nombreUsuario && nombreUsuario.includes(':')) {
        try {
          nombreUsuario = decrypt(nombreUsuario);
        } catch (decryptError) {
          console.log("No se pudo descifrar nombre de usuario:", decryptError);
        }
      }

      // Intentar descifrar la empresa si parece estar cifrada
      if (empresaUsuario && empresaUsuario.includes(':')) {
        try {
          empresaUsuario = decrypt(empresaUsuario);
        } catch (decryptError) {
          console.log("No se pudo descifrar empresa de usuario:", decryptError);
        }
      }

      // Intentar descifrar el mail si parece estar cifrado
      if (mailUsuario && mailUsuario.includes(':')) {
        try {
          mailUsuario = decrypt(mailUsuario);
        } catch (decryptError) {
          console.log("No se pudo descifrar mail de usuario:", decryptError);
        }
      }

      await generarAnexoDesdeRespuesta(
        respuesta.responses,
        respuesta._id.toString(),
        req.db,
        form.section,
        {
          nombre: nombreUsuario,
          empresa: empresaUsuario,
          uid: uidUsuario,
          mail: mailUsuario
        },
        respuesta.formId,
        respuesta.formTitle
      );


      res.json({
        success: true,
        message: "Documento regenerado exitosamente",
        responseId: id,
        formTitle: respuesta.formTitle
      });

    } catch (generationError) {
      console.error("Error en generación de documento:", generationError);
      return res.status(500).json({
        error: "Error regenerando documento: " + generationError.message
      });
    }

  } catch (error) {
    console.error('Error regenerando documento:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cambiar estado de respuesta (avanzar o retroceder)
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Verificar token
    const auth = await verifyRequest(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID de respuesta inválido" });
    }

    if (!status) {
      return res.status(400).json({ error: "Estado requerido" });
    }

    // Validar estados permitidos
    const estadosPermitidos = ['pendiente', 'en_revision', 'aprobado', 'firmado', 'finalizado', 'archivado'];
    if (!estadosPermitidos.includes(status)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const respuesta = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    if (!respuesta) {
      return res.status(404).json({ error: "Respuesta no encontrada" });
    }

    // Configurar campos según el estado
    const updateData = {
      status: status,
      updatedAt: new Date()
    };

    // Agregar timestamp específico según el estado
    if (status === 'en_revision') {
      updateData.reviewedAt = new Date();
    } else if (status === 'aprobado') {
      updateData.approvedAt = new Date();
    } else if (status === 'firmado') {
      updateData.signedAt = new Date();
    } else if (status === 'finalizado') {
      updateData.finalizedAt = new Date();
    } else if (status === 'archivado') {
      updateData.archivedAt = new Date();
    }

    const updateResult = await req.db.collection("respuestas").updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: "No se pudo actualizar la respuesta" });
    }

    const updatedResponse = await req.db.collection("respuestas").findOne({
      _id: new ObjectId(id)
    });

    const descifrarObjeto = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;

      if (Array.isArray(obj)) {
        return obj.map(item => {
          const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;
          if (typeof item === 'string' && encryptedRegex.test(item)) {
            try { return decrypt(item); } catch (error) { return item; }
          } else if (typeof item === 'object' && item !== null) {
            return descifrarObjeto(item);
          }
          return item;
        });
      }

      const resultado = {};
      for (const key in obj) {
        const valor = obj[key];
        const encryptedRegex = /^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i;
        if (typeof valor === 'string' && encryptedRegex.test(valor)) {
          try { resultado[key] = decrypt(valor); } catch (error) { resultado[key] = valor; }
        } else if (typeof valor === 'object' && valor !== null) {
          resultado[key] = descifrarObjeto(valor);
        } else {
          resultado[key] = valor;
        }
      }
      return resultado;
    };

    // Descifrar campos sensibles antes de enviar al frontend
    if (updatedResponse) {
      if (updatedResponse.user && typeof updatedResponse.user === 'object') {
        updatedResponse.user = descifrarObjeto(updatedResponse.user);
      }
      if (updatedResponse.responses && typeof updatedResponse.responses === 'object') {
        updatedResponse.responses = descifrarObjeto(updatedResponse.responses);
      }
      if (updatedResponse.mail && typeof updatedResponse.mail === 'string' && updatedResponse.mail.includes(':')) {
        try { updatedResponse.mail = decrypt(updatedResponse.mail); } catch (e) { }
      }
    }

    // Enviar notificación al usuario si aplica
    if (status === 'en_revision') {
      await addNotification(req.db, {
        userId: respuesta?.user?.uid, // Usar el original 'respuesta' que puede tener uid sin descifrar, pero uid suele no estar cifrado en user.uid si es root? 
        // Nota: Si respuesta.user.uid estaba cifrado, necesitamos usar el descifrado.
        // Pero respuesta original (antes del update) tenía los datos raw.
        // Mejor usamos updatedResponse.user.uid que ya intentamos descifrar.
        userId: updatedResponse?.user?.uid || respuesta?.user?.uid,
        titulo: "Respuestas En Revisión",
        descripcion: `Formulario ${updatedResponse.formTitle} ha cambiado su estado a En Revisión.`,
        prioridad: 2,
        icono: 'FileText',
        color: '#00c6f8ff',
        actionUrl: `/?id=${id}`,
      });
    }

    res.json({
      success: true,
      message: `Estado cambiado a '${status}'`,
      updatedRequest: updatedResponse
    });

  } catch (err) {
    console.error("Error cambiando estado:", err);
    res.status(500).json({ error: "Error cambiando estado: " + err.message });
  }
});

// MANTENIMIENTO: Migrar respuestas existentes para cifrado PQC
router.get("/mantenimiento/migrar-respuestas-pqc", async (req, res) => {
  try {
    // Importar helpers de seguridad
    const { encrypt } = require('../utils/seguridad.helper');

    const respuestas = await req.db.collection("respuestas").find().toArray();
    let cont = 0;
    let totalCamposCifrados = 0;
    let errores = 0;



    // Función para cifrar todos los strings en un objeto/array
    const cifrarObjetoCompleto = (obj) => {
      if (!obj || typeof obj !== 'object') {
        return { objeto: obj, cifrados: 0 };
      }

      let cifrados = 0;

      if (Array.isArray(obj)) {
        const nuevoArray = [];
        for (const item of obj) {
          if (typeof item === 'string' && item.trim() !== '' && !item.includes(':')) {
            nuevoArray.push(encrypt(item));
            cifrados++;
          } else if (typeof item === 'object' && item !== null) {
            const { objeto: itemCifrado, cifrados: itemCifrados } = cifrarObjetoCompleto(item);
            nuevoArray.push(itemCifrado);
            cifrados += itemCifrados;
          } else {
            nuevoArray.push(item);
          }
        }
        return { objeto: nuevoArray, cifrados };
      }

      const nuevoObj = {};
      for (const key in obj) {
        const valor = obj[key];

        if (typeof valor === 'string' && valor.trim() !== '') {
          if (valor.includes(':')) {
            // Ya está cifrado
            nuevoObj[key] = valor;
          } else {
            // Cifrar siempre
            nuevoObj[key] = encrypt(valor);
            cifrados++;
          }
        } else if (typeof valor === 'object' && valor !== null) {
          const { objeto: valorCifrado, cifrados: valorCifrados } = cifrarObjetoCompleto(valor);
          nuevoObj[key] = valorCifrado;
          cifrados += valorCifrados;
        } else {
          nuevoObj[key] = valor;
        }
      }

      return { objeto: nuevoObj, cifrados };
    };

    // Procesar cada respuesta
    for (let respuesta of respuestas) {
      const updates = {};
      let cambios = false;
      let camposEstaRespuesta = 0;

      try {
        // 1. SOLO CIFRAR 'user' COMPLETO
        if (respuesta.user && typeof respuesta.user === 'object') {
          console.log(`  Cifrando objeto 'user'...`);
          const { objeto: userCifrado, cifrados: userCifrados } = cifrarObjetoCompleto(respuesta.user);

          if (userCifrados > 0) {
            updates.user = userCifrado;
            cambios = true;
            camposEstaRespuesta += userCifrados;
          } else {
            console.log(`  user: ya cifrado o sin texto`);
          }
        }

        // 2. SOLO CIFRAR 'responses' COMPLETO
        if (respuesta.responses && typeof respuesta.responses === 'object') {
          console.log(`  Cifrando objeto 'responses'...`);
          const { objeto: responsesCifrado, cifrados: responsesCifrados } = cifrarObjetoCompleto(respuesta.responses);

          if (responsesCifrados > 0) {
            updates.responses = responsesCifrado;
            cambios = true;
            camposEstaRespuesta += responsesCifrados;
          } else {
            console.log(`  responses: ya cifrado o sin texto`);
          }
        }

        // 3. NO CIFRAR '_contexto' (si existe, lo dejamos igual)
        if (respuesta._contexto) {
          console.log(` _contexto: NO se cifra (se mantiene igual)`);
          // No hacemos nada con _contexto
        }

        // 4. NO CIFRAR campos del nivel principal
        // formId, formTitle, status, fechas, etc. se mantienen SIN CIFRAR

        // Actualizar en BD solo si hubo cambios en user o responses
        if (cambios && Object.keys(updates).length > 0) {
          // Solo añadir updatedAt
          updates.updatedAt = new Date().toISOString();

          await req.db.collection("respuestas").updateOne(
            { _id: respuesta._id },
            { $set: updates }
          );

          cont++;
          totalCamposCifrados += camposEstaRespuesta;
        } else {
          console.log(` Sin cambios necesarios`);
        }

      } catch (error) {
        console.error(` Error procesando respuesta:`, error.message);
        errores++;
      }
    }

    console.log(`\n=== MIGRACIÓN COMPLETADA ===`);

    res.json({
      success: true,
      message: `Migración PQC completada: ${cont}/${respuestas.length} respuestas actualizadas`,
      estadisticas: {
        totalRespuestas: respuestas.length,
        respuestasActualizadas: cont,
        respuestasSinCambios: respuestas.length - cont,
        totalCamposCifrados: totalCamposCifrados,
        promedioCamposPorRespuesta: cont > 0 ? (totalCamposCifrados / cont).toFixed(2) : 0,
        erroresEncontrados: errores
      },
      nota: "Solo se cifraron los objetos 'user' y 'responses'. Campos como status, formId, fechas se mantienen sin cifrar."
    });

  } catch (err) {
    console.error('Error en migración PQC:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack
    });
  }
});


module.exports = router;