const express = require("express");
const router = express.Router({ mergeParams: true });
const { ObjectId } = require("mongodb");
const multer = require("multer");
const { validarToken } = require("../utils/validarToken");

// --- UTILS ---

const getCentralDB = (req) => {
    return req.mongoClient.db("formsdb");
};

// Multer Config
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Formato no válido. Solo PDF, JPG y PNG."));
        }
    }
});

// --- MIDDLEWARE ---

const verifyAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: "No autorizado. Token faltante." });
        }

        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "Formato de token inválido." });
        }

        let dbToUse = req.db;
        if (!dbToUse && req.mongoClient) {
            dbToUse = req.mongoClient.db("formsdb");
        }

        if (!dbToUse) {
            console.error("[Pagos] Error: No database connection available for token validation");
            return res.status(500).json({ error: "Configuration Error: No DB connection" });
        }

        const validation = await validarToken(dbToUse, token);

        if (!validation.ok) {
            return res.status(401).json({ error: validation.reason });
        }

        req.user = validation.data;
        next();
    } catch (error) {
        console.error("Error en middleware de autenticación:", error);
        res.status(500).json({ error: "Error interno de autenticación." });
    }
};

// --- ENDPOINTS (Refactored for Cobros System) ---

/**
 * ENPOINT: Generar Cobros (Admin)
 * Crea registros en la colección 'cobros' para las empresas seleccionadas.
 * Body: { companies: [{ dbName, name }], amount, concept, period }
 */
router.post("/admin/generate-charges", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);

        // ADMIN CHECK
        let dbToUse = req.db;
        if (!dbToUse && req.mongoClient) dbToUse = req.mongoClient.db("formsdb");
        if (!dbToUse || (dbToUse.databaseName !== 'formsdb' && dbToUse.databaseName !== 'api')) {
            return res.status(403).json({ error: "Acceso denegado: Solo administradores." });
        }

        const { companies, amount, concept, period } = req.body;

        if (!companies || !Array.isArray(companies) || companies.length === 0) {
            return res.status(400).json({ error: "Debe seleccionar al menos una empresa." });
        }
        if (!concept) {
            return res.status(400).json({ error: "El concepto es requerido." });
        }

        const batch = companies.map(company => ({
            companyDb: company.dbName,
            companyName: company.name,
            amount: parseFloat(company.amount || amount),
            concept: concept,
            period: period || new Date().toISOString().slice(0, 7), // YYYY-MM per default
            status: "Pendiente",
            createdAt: new Date(),
            updatedAt: new Date(),
            receipt: null // Will hold file info later
        }));

        const result = await db.collection("cobros").insertMany(batch);

        res.status(201).json({
            message: `Se generaron ${result.insertedCount} cobros exitosamente.`,
            ids: result.insertedIds
        });

    } catch (error) {
        console.error("Error generating charges:", error);
        res.status(500).json({ error: "Error al generar cobros." });
    }
});

/**
 * ENDPOINT: Get Dashboard Stats (Admin)
 * Obtiene métricas globales y por empresa.
 */
router.get("/admin/dashboard-stats", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);

        // ADMIN CHECK
        let dbToUse = req.db;
        if (!dbToUse && req.mongoClient) dbToUse = req.mongoClient.db("formsdb");
        if (!dbToUse || (dbToUse.databaseName !== 'formsdb' && dbToUse.databaseName !== 'api')) {
            return res.status(403).json({ error: "Acceso denegado." });
        }

        // 1. Global Stats
        const globalStats = await db.collection("cobros").aggregate([
            {
                $group: {
                    _id: null,
                    totalCollected: {
                        $sum: { $cond: [{ $eq: ["$status", "Aprobado"] }, "$amount", 0] }
                    },
                    totalPending: {
                        $sum: {
                            $cond: [{ $in: ["$status", ["Pendiente", "En Revisión"]] }, "$amount", 0]
                        }
                    },
                    countPending: {
                        $sum: {
                            $cond: [{ $in: ["$status", ["Pendiente", "En Revisión"]] }, 1, 0]
                        }
                    }
                }
            }
        ]).toArray();

        // 2. Stats per Company
        const companyStats = await db.collection("cobros").aggregate([
            {
                $group: {
                    _id: "$companyDb",
                    lastChargeDate: { $max: "$createdAt" },
                    pendingCount: {
                        $sum: {
                            $cond: [{ $in: ["$status", ["Pendiente", "En Revisión"]] }, 1, 0]
                        }
                    },
                    pendingAmount: {
                        $sum: {
                            $cond: [{ $in: ["$status", ["Pendiente", "En Revisión"]] }, "$amount", 0]
                        }
                    }
                }
            }
        ]).toArray();

        // Convert array to map for easier frontend lookup
        const statsByCompany = {};
        companyStats.forEach(stat => {
            statsByCompany[stat._id] = stat;
        });

        res.json({
            global: globalStats[0] || { totalCollected: 0, totalPending: 0, countPending: 0 },
            byCompany: statsByCompany
        });

    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ error: "Error al obtener estadísticas." });
    }
});

/**
 * ENDPOINT: Get Charges by Company (Admin View)
 * Obtiene el historial de cobros para una empresa específica.
 */
router.get("/admin/charges/:companyDb", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { companyDb } = req.params;

        // ADMIN CHECK
        let dbToUse = req.db;
        if (!dbToUse && req.mongoClient) dbToUse = req.mongoClient.db("formsdb");
        if (!dbToUse || (dbToUse.databaseName !== 'formsdb' && dbToUse.databaseName !== 'api')) {
            return res.status(403).json({ error: "Acceso denegado." });
        }

        const charges = await db.collection("cobros")
            .find({ companyDb: companyDb })
            .project({ "receipt.file.data": 0 }) // Exclude binary data
            .sort({ createdAt: -1 })
            .toArray();

        res.json(charges);
    } catch (error) {
        console.error("Error fetching charges for company:", error);
        res.status(500).json({ error: "Error al obtener cobros." });
    }
});

/**
 * ENDPOINT: Get My Charges (Client View)
 * El cliente obtiene sus propios cobros usando su dbName (obtenido del token/contexto o params)
 * Para mayor seguridad, usamos el req.params.company que viene del frontend (verificado con su token si es necesario, 
 * pero aqui simplificamos asumiendo que el frontend envia su propio identificador correcto, o lo sacamos del token).
 * 
 * En este caso, el router tiene mergeParams, si el frontend llama /pagos/:company/my-charges
 */
router.get("/client/my-charges", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);

        // Determinar la companyDb del usuario actual
        // El frontend suele enviar la company en la URL base si configuramos rutas asi, 
        // pero aqui asumimos que 'req.params.company' viene por el middleware de app.use('/pagos/:company', ...)
        const companyDb = req.params.company;

        if (!companyDb) {
            return res.status(400).json({ error: "Contexto de empresa no definido." });
        }

        const charges = await db.collection("cobros")
            .find({ companyDb: companyDb }) // Buscar por el identificador de la DB o nombre unico
            .project({ "receipt.file.data": 0 })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(charges);
    } catch (error) {
        console.error("Error fetching client charges:", error);
        res.status(500).json({ error: "Error al obtener mis cobros." });
    }
});

/**
 * ENDPOINT: Upload Receipt for Charge (Client)
 * Sube el comprobante para un Cobro específico.
 */
router.post("/client/upload/:chargeId", verifyAuth, upload.single("file"), async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { chargeId } = req.params;
        const user = req.user;

        if (!ObjectId.isValid(chargeId)) {
            return res.status(400).json({ error: "ID de cobro inválido." });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Debe subir un archivo." });
        }

        const charge = await db.collection("cobros").findOne({ _id: new ObjectId(chargeId) });
        if (!charge) {
            return res.status(404).json({ error: "Cobro no encontrado." });
        }

        // Actualizar el cobro con el comprobante y cambiar estado a "En Revisión"
        const updateResult = await db.collection("cobros").updateOne(
            { _id: new ObjectId(chargeId) },
            {
                $set: {
                    status: "En Revisión",
                    updatedAt: new Date(),
                    receipt: {
                        uploadedBy: user ? user.email : "anonymous",
                        uploadedAt: new Date(),
                        file: {
                            name: req.file.originalname,
                            mimetype: req.file.mimetype,
                            size: req.file.size,
                            data: req.file.buffer // Binary
                        }
                    }
                }
            }
        );

        if (updateResult.modifiedCount === 0) {
            return res.status(500).json({ error: "No se pudo actualizar el cobro." });
        }

        res.json({ message: "Comprobante subido exitosamente.", status: "En Revisión" });

    } catch (error) {
        console.error("Error uploading receipt:", error);
        res.status(500).json({ error: "Error interno al subir comprobante." });
    }
});

/**
 * ENDPOINT: Update Status (Admin)
 * Aprobar o Rechazar un pago.
 */
router.put("/admin/status/:chargeId", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { chargeId } = req.params;
        const { status, feedback } = req.body; // feedback opcional para rechazos

        // ADMIN CHECK
        let dbToUse = req.db;
        if (!dbToUse && req.mongoClient) dbToUse = req.mongoClient.db("formsdb");
        if (!dbToUse || (dbToUse.databaseName !== 'formsdb' && dbToUse.databaseName !== 'api')) {
            return res.status(403).json({ error: "Acceso denegado." });
        }

        if (!ObjectId.isValid(chargeId)) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const updateData = {
            status: status,
            updatedAt: new Date()
        };
        if (feedback) updateData.feedback = feedback;

        const result = await db.collection("cobros").updateOne(
            { _id: new ObjectId(chargeId) },
            { $set: updateData }
        );

        res.json({ message: "Estado actualizado correctamente." });

    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ error: "Error al actualizar estado." });
    }
});

/**
 * ENDPOINT: Get Receipt File (Download)
 * Descarga el archivo del comprobante asociado a un cobro.
 */
router.get("/file/:chargeId", verifyAuth, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { chargeId } = req.params;

        if (!ObjectId.isValid(chargeId)) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const doc = await db.collection("cobros").findOne(
            { _id: new ObjectId(chargeId) },
            { projection: { "receipt.file": 1 } }
        );

        if (!doc || !doc.receipt || !doc.receipt.file) {
            return res.status(404).json({ error: "Archivo no encontrado." });
        }

        const file = doc.receipt.file;
        res.setHeader("Content-Type", file.mimetype);
        res.setHeader("Content-Disposition", `inline; filename="${file.name}"`);
        res.send(file.data.buffer);

    } catch (error) {
        console.error("Error serving file:", error);
        res.status(500).json({ error: "Error al obtener el archivo." });
    }
});

module.exports = router;
