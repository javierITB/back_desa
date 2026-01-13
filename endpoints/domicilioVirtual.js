const express = require("express");
const router = express.Router();
const { ObjectId, GridFSBucket } = require("mongodb");
const multer = require('multer');
const { validarToken } = require("../utils/validarToken.js");
const { sendEmail } = require("../utils/mail.helper");
const { addNotification } = require("../utils/notificaciones.helper");
const { generarAnexoDesdeRespuesta } = require("../utils/generador.helper");
const { encrypt, decrypt } = require("../utils/seguridad.helper");

// Helper para normalizar nombres
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
        extension = extension.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toLowerCase();
    }
    if (!extension) extension = 'bin';
    let normalized = nameWithoutExt
        .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
        .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I').replace(/Ó/g, 'O').replace(/Ú/g, 'U').replace(/Ü/g, 'U')
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

// Configurar Multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 }
});
const uploadMultiple = upload;

// Helper para verificar token
const verifyRequest = async (req) => {
    let token = req.headers.authorization?.split(" ")[1];
    if (!token && req.body?.user?.token) token = req.body.user.token;
    if (!token && req.query?.token) token = req.query.token;
    if (!token) return { ok: false, error: "Token no proporcionado" };
    const valid = await validarToken(req.db, token);
    if (!valid.ok) return { ok: false, error: valid.reason };
    return { ok: true, data: valid.data };
};

// ==========================================
// ENDPOINTS DOMICILIO VIRTUAL
// ==========================================

// 1. Obtener lista (Dashboard Mini)
router.get("/mini", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const { status, company, search, submittedBy, dateRange, startDate, endDate } = req.query; 

        const collection = req.db.collection("domicilio_virtual");

        // 1. CONSTRUCCIÓN DEL FILTRO DE BASE DE DATOS
        const filter = {};
        if (status && status !== "") filter.status = status;

        // Lógica de Fechas (startDate / endDate)
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = end;
            }
        } 
        // Lógica de Período Predefinido (dateRange)
        else if (dateRange && dateRange !== "") {
            const now = new Date();
            const startOfPeriod = new Date();
            startOfPeriod.setHours(0, 0, 0, 0);

            if (dateRange === 'today') {
                filter.createdAt = { $gte: startOfPeriod };
            } else if (dateRange === 'week') {
                const day = startOfPeriod.getDay();
                const diff = startOfPeriod.getDate() - day + (day === 0 ? -6 : 1);
                filter.createdAt = { $gte: new Date(startOfPeriod.setDate(diff)) };
            } else if (dateRange === 'month') {
                filter.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
            } else if (dateRange === 'year') {
                filter.createdAt = { $gte: new Date(now.getFullYear(), 0, 1) };
            }
        }

        // 2. EJECUCIÓN EN DB (Ya filtrado por fecha y estado)
        const answers = await collection.find(filter)
            .sort({ createdAt: -1 })
            .toArray();

        // 3. PROCESAMIENTO Y DESENCRIPTACIÓN
        let answersProcessed = answers.map(answer => {
            const getVal = (keys) => {
                const responseKeys = Object.keys(answer.responses || {});
                for (let searchKey of keys) {
                    const actualKey = responseKeys.find(k => 
                        k.toLowerCase().trim().replace(":", "") === searchKey.toLowerCase()
                    );
                    if (actualKey && answer.responses[actualKey]) {
                        try {
                            return decrypt(answer.responses[actualKey]);
                        } catch (e) { return answer.responses[actualKey]; }
                    }
                }
                return "";
            };

            const nombreCliente = getVal(["tu nombre", "nombre o razón social", "nombre"]);
            const rutCliente = getVal(["rut de la empresa", "rut representante legal"]);

            return {
                _id: answer._id,
                formId: answer.formId,
                formTitle: answer.formTitle,
                tuNombre: nombreCliente, 
                rutEmpresa: rutCliente,
                submittedAt: answer.submittedAt || answer.createdAt,
                status: answer.status,
                createdAt: answer.createdAt,
                adjuntosCount: 0
            };
        });

        // 4. FILTROS EN MEMORIA (Texto desencriptado)
        if (company && company.trim() !== "") {
            const term = company.toLowerCase().trim();
            answersProcessed = answersProcessed.filter(a => a.rutEmpresa.toLowerCase().includes(term));
        }

        if (submittedBy && submittedBy.trim() !== "") {
            const term = submittedBy.toLowerCase().trim();
            answersProcessed = answersProcessed.filter(a => a.tuNombre.toLowerCase().includes(term));
        }

        if (search && search.trim() !== "") {
            const term = search.toLowerCase().trim();
            answersProcessed = answersProcessed.filter(a => 
                a.tuNombre.toLowerCase().includes(term) || a.rutEmpresa.toLowerCase().includes(term)
            );
        }

        // 5. RESPUESTA Y PAGINACIÓN
        const totalFiltered = answersProcessed.length;
        const paginatedData = answersProcessed.slice((page - 1) * limit, page * limit);

        const statusCounts = await collection.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]).toArray();

        res.json({
            success: true,
            data: paginatedData,
            pagination: {
                total: totalFiltered,
                page: page,
                limit: limit,
                totalPages: Math.ceil(totalFiltered / limit)
            },
            stats: {
                total: totalFiltered,
                documento_generado: statusCounts.find(s => s._id === 'documento_generado')?.count || 0,
                solicitud_firmada: statusCounts.find(s => s._id === 'solicitud_firmada')?.count || 0,
                informado_sii: statusCounts.find(s => s._id === 'informado_sii')?.count || 0,
                pending: statusCounts.find(s => s._id === 'pendiente')?.count || 0
            }
        });

    } catch (err) {
        console.error("Error en /mini:", err);
        res.status(500).json({ error: "Error interno al filtrar" });
    }
});
// 2. Obtener detalle (GET /:id)
router.get("/:id", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const answer = await req.db.collection("domicilio_virtual").findOne({ _id: new ObjectId(req.params.id) });
        if (!answer) return res.status(404).json({ error: "No encontrado" });

        const result = {
            ...answer,
            user: answer.user ? {
                ...answer.user,
                nombre: decrypt(answer.user.nombre),
                rut: decrypt(answer.user.rut),
                empresa: decrypt(answer.user.empresa),
                mail: decrypt(answer.user.mail),
                telefono: decrypt(answer.user.telefono)
            } : null,
        };

        if (answer.responses) {
            const descifrarValor = (valor) => {
                if (typeof valor === 'string' && valor.includes(':')) {
                    try { return decrypt(valor); } catch (e) { return valor; }
                }
                if (Array.isArray(valor)) {
                    return valor.map(item => descifrarValor(item));
                }
                if (typeof valor === 'object' && valor !== null) {
                    const res = {};
                    for (const k in valor) res[k] = descifrarValor(valor[k]);
                    return res;
                }
                return valor;
            };

            const decryptedResponses = {};
            for (const [key, value] of Object.entries(answer.responses)) {
                decryptedResponses[key] = descifrarValor(value);
            }
            result.responses = decryptedResponses;
        }

        const adjuntosDoc = await req.db.collection("adjuntos").findOne({ responseId: answer._id });
        if (adjuntosDoc && adjuntosDoc.adjuntos) {
            result.adjuntos = adjuntosDoc.adjuntos.map(adj => ({
                ...adj,
                fileName: adj.fileName || adj.name,
                mimeType: adj.mimeType || adj.type
            }));
        }
        res.json(result);
    } catch (err) {
        console.error("Error en GET /:id:", err);
        res.status(500).json({ error: "Error interno: " + err.message });
    }
});

// 3. Crear solicitud (POST /)
router.post("/", async (req, res) => {
    try {
        const { formId, responses, formTitle, adjuntos = [], user } = req.body;

        // Verificar formulario
        const form = await req.db.collection("forms").findOne({ _id: new ObjectId(formId) });
        if (!form) return res.status(404).json({ error: "Formulario no encontrado" });

        // Función cifrado recursivo
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
                            if (typeof item === 'string' && item.trim() !== '' && !item.includes(':')) return encrypt(item);
                            if (typeof item === 'object' && item !== null) return cifrarObjeto(item);
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

        const responsesCifrado = cifrarObjeto(responses);

        // Guardar
        const result = await req.db.collection("domicilio_virtual").insertOne({
            formId,
            responses: responsesCifrado,
            formTitle,
            status: "documento_generado",
            createdAt: new Date(),
            updatedAt: new Date()
        });

        if (adjuntos.length > 0) {
            await req.db.collection("adjuntos").insertOne({
                responseId: result.insertedId,
                submittedAt: new Date().toISOString(),
                adjuntos: adjuntos
            });
        }

        // CREAR TICKET AUTOMATICO
        try {
            // Extraer nombre del cliente (priorizando "Tu nombre")
            let nombreCliente = "Cliente";
            const keys = Object.keys(responses || {});

            const tuNombreKey = keys.find(k => ['tu nombre', 'tu nombre:', 'nombre solicitante'].includes(k.trim().toLowerCase()));

            const fuzzyNameKey = keys.find(k =>
                k.toLowerCase().includes('nombre') &&
                !k.toLowerCase().includes('empresa') &&
                !k.toLowerCase().includes('trabajador') &&
                !k.toLowerCase().includes('razón') &&
                !k.toLowerCase().includes('razon') &&
                !k.toLowerCase().includes('social')
            );

            const finalNameKey = tuNombreKey || fuzzyNameKey;

            if (finalNameKey && responses[finalNameKey]) {
                nombreCliente = responses[finalNameKey];
            } else if (user && user.nombre) {
                nombreCliente = user.nombre;
            }

            // Construir asunto
            const ticketTitle = `${formTitle} - ${nombreCliente}`;

            // Insertar ticket en soporte
            await req.db.collection("soporte").insertOne({
                formId: formId, // Usar ID real del formulario para que aparezca en panel admin
                user: user, // Se guarda el usuario asociado
                responses: responses, // Se guardan las respuestas en texto plano para el ticket
                formTitle: ticketTitle,
                mail: "",
                status: "pendiente",
                priority: "alta",
                relatedRequestId: result.insertedId, // Vinculación interna
                origin: "domicilio_virtual",
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log(`Ticket automático creado para solicitud ${result.insertedId}`);

        } catch (ticketError) {
            console.error("Error al crear ticket automático:", ticketError);
        }

        // Notificaciones
        const notifData = {
            titulo: `Alguien ha respondido en Domicilio Virtual: ${formTitle}`,
            descripcion: adjuntos.length > 0 ? `Incluye ${adjuntos.length} archivo(s)` : "Revisar en panel.",
            prioridad: 2,
            color: "#bb8900ff",
            icono: "Edit",
            actionUrl: `/RespuestasForms?id=${result.insertedId}`,
        };
        await addNotification(req.db, { filtro: { cargo: "RRHH" }, ...notifData });
        await addNotification(req.db, { filtro: { cargo: "admin" }, ...notifData });

        // Anexo
        try {
            await generarAnexoDesdeRespuesta(responses, result.insertedId.toString(), req.db, form.section, {
                nombre: null, empresa: null, uid: null,
            }, formId, formTitle);
        } catch (error) {
            console.error("Error generando documento:", error.message);
        }

        res.json({
            _id: result.insertedId,
            formId,
            responses,
            formTitle,
            message: "Solicitud enviada correctamente"
        });
    } catch (err) {
        console.error("Error guardar Domicilio Virtual:", err);
        res.status(500).json({ error: "Error al guardar: " + err.message });
    }
});

// 4. Listar Adjuntos (GET /:id/adjuntos)
router.get("/:id/adjuntos", async (req, res) => {
    try {
        const adjuntosDoc = await req.db.collection("adjuntos").findOne({ responseId: new ObjectId(req.params.id) });
        if (!adjuntosDoc || !adjuntosDoc.adjuntos) return res.json([]);
        res.json(adjuntosDoc.adjuntos);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener adjuntos" });
    }
});

// 5. Descargar Adjunto (GET /:id/adjuntos/:index)
router.get("/:id/adjuntos/:index", async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const adjuntosDoc = await req.db.collection("adjuntos").findOne({ responseId: new ObjectId(req.params.id) });

        if (!adjuntosDoc || !adjuntosDoc.adjuntos || !adjuntosDoc.adjuntos[index]) {
            return res.status(404).json({ error: "Adjunto no encontrado" });
        }

        const adjunto = adjuntosDoc.adjuntos[index];
        if (!adjunto.fileId) return res.status(404).json({ error: "Archivo físico no encontrado" });

        const bucket = new GridFSBucket(req.db, { bucketName: 'adjuntos' });
        const downloadStream = bucket.openDownloadStream(new ObjectId(adjunto.fileId));

        res.set('Content-Type', adjunto.mimeType || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${adjunto.fileName}"`);
        downloadStream.pipe(res);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al descargar adjunto" });
    }
});

// 6. Subir Adjunto Público (POST /:id/adjuntos)
router.post("/:id/adjuntos", async (req, res) => {
    try {
        const { id } = req.params;
        const { adjunto, index, total } = req.body;

        const esDomicilioVirtual = await req.db.collection("domicilio_virtual").findOne({ _id: new ObjectId(id) });
        if (!esDomicilioVirtual) return res.status(404).json({ error: "Solicitud no encontrada" });

        if (!adjunto) return res.status(400).json({ error: "Faltan datos de adjunto" });

        const adjuntoNormalizado = {
            pregunta: adjunto.pregunta || "Adjuntar documento aquí",
            fileName: adjunto.fileName,
            fileData: adjunto.fileData,
            mimeType: adjunto.mimeType || 'application/pdf',
            size: adjunto.size || 0,
            uploadedAt: new Date().toISOString()
        };

        const documentoAdjuntos = await req.db.collection("adjuntos").findOne({ responseId: new ObjectId(id) });
        if (!documentoAdjuntos) {
            await req.db.collection("adjuntos").insertOne({
                responseId: new ObjectId(id),
                submittedAt: new Date().toISOString(),
                adjuntos: [adjuntoNormalizado]
            });
        } else {
            await req.db.collection("adjuntos").updateOne(
                { responseId: new ObjectId(id) },
                { $push: { adjuntos: adjuntoNormalizado } }
            );
        }

        if (adjunto.fileData) {
            const buffer = Buffer.from(adjunto.fileData.split(',')[1], 'base64');
            const bucket = new GridFSBucket(req.db, { bucketName: 'adjuntos' });
            const uploadStream = bucket.openUploadStream(adjuntoNormalizado.fileName, {
                contentType: adjuntoNormalizado.mimeType,
                metadata: { responseId: new ObjectId(id), type: 'domicilio_virtual_attachment' }
            });
            uploadStream.end(buffer);
            uploadStream.on('finish', async () => {
                await req.db.collection("adjuntos").updateOne(
                    { responseId: new ObjectId(id), "adjuntos.fileName": adjuntoNormalizado.fileName },
                    { $set: { "adjuntos.$.fileId": uploadStream.id } }
                );
            });
        }
        res.json({ success: true, message: "Adjunto subido" });
    } catch (err) {
        console.error("Error subiendo adjunto:", err);
        res.status(500).json({ error: "Error interno" });
    }
});

// 7. Actualizar Estado (PUT /:id/status)
router.put("/:id/status", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const { status } = req.body;
        await req.db.collection("domicilio_virtual").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: status, updatedAt: new Date() } }
        );
        const updatedRequest = await req.db.collection("domicilio_virtual").findOne({ _id: new ObjectId(req.params.id) });

        const responses = updatedRequest.responses || {};

        
        // Descifrar user si existe para devolver
        if (updatedRequest.responses) {

           
            
                Object.keys(responses).forEach(key => {
                    responses[key] = decrypt(responses[key]) || " - ";
                });
            
            updatedRequest.responses = responses;


        }

        res.json({ success: true, updatedRequest });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error actualizando estado" });
    }
});

// 8. Admin: Subir archivos corregidos (POST /upload-corrected-files)
router.post("/upload-corrected-files", async (req, res) => {
    uploadMultiple.array('files', 10)(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        try {
            const auth = await verifyRequest(req);
            if (!auth.ok) return res.status(401).json({ error: auth.error });

            const { responseId, index } = req.body;
            const files = req.files;
            if (!files || files.length === 0) return res.status(400).json({ error: 'No files' });

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
                const existingApproval = await req.db.collection("aprobados").findOne({ responseId: new ObjectId(responseId) });
                if (existingApproval) {
                    await req.db.collection("aprobados").updateOne(
                        { responseId: new ObjectId(responseId) },
                        { $push: { correctedFiles: correctedFile }, $set: { updatedAt: new Date() } }
                    );
                } else {
                    await req.db.collection("aprobados").insertOne({
                        responseId: new ObjectId(responseId),
                        correctedFiles: [correctedFile],
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        approvedAt: null,
                        approvedBy: auth.data.nombre || 'Admin'
                    });
                }
            }
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
});

// 9. Admin: Obtener datos aprobados (GET /data-approved/:id)
router.get("/data-approved/:id", async (req, res) => {
    try {
        const data = await req.db.collection("aprobados").findOne({ responseId: new ObjectId(req.params.id) });
        res.json(data || null);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 10. Admin: Aprobar (POST /:id/approve)
router.post("/:id/approve", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        await req.db.collection("domicilio_virtual").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'aprobado', updatedAt: new Date(), approvedBy: auth.data.nombre } }
        );
        await req.db.collection("aprobados").updateOne(
            { responseId: new ObjectId(req.params.id) },
            { $set: { approvedAt: new Date(), approvedBy: auth.data.nombre } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 11. Admin: Eliminar solicitud/correción (DELETE /:id/remove-correction)
router.delete("/:id/remove-correction", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        await req.db.collection("aprobados").deleteOne({ responseId: new ObjectId(req.params.id) });
        await req.db.collection("domicilio_virtual").updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'en_revision', updatedAt: new Date() } }
        );
        res.json({ success: true, updatedRequest: { status: 'en_revision' } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 12. Admin: Eliminar archivo (DELETE /delete-corrected-file/:id)
router.delete("/delete-corrected-file/:id", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });
        const { fileName } = req.body;
        await req.db.collection("aprobados").updateOne(
            { responseId: new ObjectId(req.params.id) },
            { $pull: { correctedFiles: { fileName: fileName } } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 13. Admin: Descargar PDF (GET /download-approved-pdf/:id)
router.get("/download-approved-pdf/:id", async (req, res) => {
    try {
        const index = parseInt(req.query.index) || 0;
        const doc = await req.db.collection("aprobados").findOne({ responseId: new ObjectId(req.params.id) });
        if (!doc || !doc.correctedFiles || !doc.correctedFiles[index]) return res.status(404).json({ error: "Archivo no encontrado" });
        const file = doc.correctedFiles[index];
        res.set('Content-Type', file.mimeType || 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
        res.send(file.fileData.buffer);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 14. Check Client Signature (Mock)
router.get("/:id/has-client-signature", async (req, res) => {
    res.json({ exists: false });
});

module.exports = router;
