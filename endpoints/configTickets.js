const express = require("express");
const router = express.Router();

const { validarToken } = require("../utils/validarToken.js");

// Helper para verificar token
const verifyRequest = async (req) => {
    let token = req.headers.authorization?.split(" ")[1];
    if (!token && req.query?.token) token = req.query.token;
    if (!token) return { ok: false, error: "Token no proporcionado" };

    const valid = await validarToken(req.db, token);
    if (!valid.ok) return { ok: false, error: valid.reason };

    return { ok: true, user: valid.user };
};

router.get("/", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const db = req.db;
        const collection = db.collection("config_tickets");

        const count = await collection.countDocuments();
        if (count === 0) {
            const defaults = [
                {
                    name: "Domicilio Virtual",
                    key: "domicilio_virtual",
                    statuses: [
                        { label: "Documento Generado", value: "documento_generado", color: "indigo" },
                        { label: "Enviado", value: "enviado", color: "blue" },
                        { label: "Aprobado", value: "aprobado", color: "green" },
                        { label: "Firmado", value: "firmado", color: "purple" },
                        { label: "Finalizado", value: "finalizado", color: "gray" },
                        { label: "Archivado", value: "archivado", color: "red" }
                    ]
                },
                {
                    name: "Sistema",
                    key: "sistema",
                    statuses: [
                        { label: "Pendiente", value: "pendiente", color: "yellow" },
                        { label: "En Revisión", value: "en_revision", color: "blue" },
                        { label: "Finalizado", value: "finalizado", color: "gray" },
                        { label: "Archivado", value: "archivado", color: "red" }
                    ]
                }
            ];
            await collection.insertMany(defaults);
        }

        const configs = await collection.find({}).toArray();
        res.json(configs);
    } catch (err) {
        console.error("Error fetching ticket config:", err);
        res.status(500).json({ error: "Error al obtener configuración" });
    }
});

// Crear nueva configuración de categoría
router.post("/", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const { name, icon } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: "El nombre es requerido." });
        }

        const db = req.db;
        const collection = db.collection("config_tickets");

        // Generar key a partir del nombre
        const key = name.toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '_')
            .replace(/^-+|-+$/g, '');

        if (!key) {
            return res.status(400).json({ error: "Nombre inválido para generar clave." });
        }

        const existing = await collection.findOne({ key });
        if (existing) {
            return res.status(400).json({ error: "Ya existe una categoría con esa clave." });
        }

        const newConfig = {
            name,
            key,
            icon: icon || "FileText",
            statuses: [],
            subcategories: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await collection.insertOne(newConfig);

        res.json({ success: true, message: "Categoría creada", config: newConfig });

    } catch (err) {
        console.error("Error creating ticket config:", err);
        res.status(500).json({ error: "Error al crear configuración" });
    }
});


// Actualizar configuración de una categoría de tickets
router.put("/:key", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const { key } = req.params;
        const { statuses, subcategories, icon } = req.body;

        if (!statuses || !Array.isArray(statuses)) {
            return res.status(400).json({ error: "Formato inválido. 'statuses' debe ser un array." });
        }

        if (subcategories && !Array.isArray(subcategories)) {
            return res.status(400).json({ error: "Formato inválido. 'subcategories' debe ser un array." });
        }

        const db = req.db;
        const collection = db.collection("config_tickets");

        const updateData = { statuses, updatedAt: new Date() };
        if (subcategories !== undefined) {
            updateData.subcategories = subcategories;
        }
        if (icon !== undefined) {
            updateData.icon = icon;
        }

        const result = await collection.updateOne(
            { key: key },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Categoría no encontrada" });
        }

        res.json({ success: true, message: "Configuración actualizada" });
    } catch (err) {
        console.error("Error updating ticket config:", err);
        res.status(500).json({ error: "Error al actualizar configuración" });
    }
});

// Eliminar categoría
router.delete("/:key", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const { key } = req.params;
        const db = req.db;
        const collection = db.collection("config_tickets");

        const result = await collection.deleteOne({ key });

        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Categoría no encontrada" });
        }

        res.json({ success: true, message: "Categoría eliminada" });
    } catch (err) {
        console.error("Error deleting ticket config:", err);
        res.status(500).json({ error: "Error al eliminar categoría" });
    }
});

module.exports = router;
