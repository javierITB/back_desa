const express = require("express");
const router = express.Router({ mergeParams: true }); // Important for :company param
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


// --- ENDPOINTS ---

// 1. Upload Comprobante (Client)
router.post("/upload", validarToken, upload.single("file"), async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { amount, date, concept } = req.body;
        const company = req.params.company; // The company from the URL (the client's company)
        const user = req.user; // From validarToken

        if (!req.file) {
            return res.status(400).json({ error: "No se ha subido ningún archivo." });
        }

        const newComprobante = {
            company: company,
            userEmail: user ? user.email : "anonymous",
            userId: user ? user.userId : null,
            amount: amount,
            date: date, // Should be ISO date string or similar
            concept: concept,
            status: "Pendiente",
            file: {
                name: req.file.originalname,
                mimetype: req.file.mimetype,
                data: req.file.buffer, // Binary data
                size: req.file.size
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection("comprobantes").insertOne(newComprobante);

        res.status(201).json({ message: "Comprobante subido exitosamente", id: result.insertedId });

    } catch (error) {
        console.error("Error uploading comprobante:", error);
        res.status(500).json({ error: "Error interno al subir el comprobante." });
    }
});

// 2. Get History (Client View - filtered by company)
router.get("/history", validarToken, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const company = req.params.company;

        // Project fields to exclude heavy file data
        const comprobantes = await db.collection("comprobantes")
            .find({ company: company })
            .project({ "file.data": 0 }) // Exclude binary data
            .sort({ createdAt: -1 })
            .toArray();

        res.json(comprobantes);
    } catch (error) {
        console.error("Error fetching history:", error);
        res.status(500).json({ error: "Error al obtener el historial." });
    }
});

// 3. Get All (Admin View - requires generic 'view_pagos' logic, assuming 'formsdb' context/user)
router.get("/admin/all", validarToken, async (req, res) => {
    try {
        const db = getCentralDB(req);

        // Ensure only authorized users can see this (simplified check)
        // In a real app, check permissions against 'view_pagos'

        const comprobantes = await db.collection("comprobantes")
            .find({})
            .project({ "file.data": 0 })
            .sort({ createdAt: -1 })
            .toArray();

        res.json(comprobantes);
    } catch (error) {
        console.error("Error fetching admin data:", error);
        res.status(500).json({ error: "Error al obtener los datos de administración." });
    }
});

// 4. Update Status (Admin)
router.put("/:id/status", validarToken, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { id } = req.params;
        const { status } = req.body; // 'Aprobado', 'Rechazado', 'Pendiente'

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "ID inválido" });
        }

        const result = await db.collection("comprobantes").updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    status: status,
                    updatedAt: new Date()
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Comprobante no encontrado" });
        }

        res.json({ message: "Estado actualizado correctamente" });
    } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).json({ error: "Error al actualizar el estado." });
    }
});

// 5. Get File (Download/View)
router.get("/file/:id", validarToken, async (req, res) => {
    try {
        const db = getCentralDB(req);
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ error: "ID inválido" });
        }

        const doc = await db.collection("comprobantes").findOne(
            { _id: new ObjectId(id) },
            { projection: { file: 1 } }
        );

        if (!doc || !doc.file) {
            return res.status(404).json({ error: "Archivo no encontrado" });
        }

        res.setHeader("Content-Type", doc.file.mimetype);
        res.setHeader("Content-Disposition", `inline; filename="${doc.file.name}"`);
        res.send(doc.file.data.buffer); // doc.file.data is Binary, .buffer gives the raw buffer

    } catch (error) {
        console.error("Error serving file:", error);
        res.status(500).json({ error: "Error al obtener el archivo." });
    }
});

module.exports = router;
