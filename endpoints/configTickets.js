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


// Actualizar configuración de una categoría de tickets
router.put("/:key", async (req, res) => {
    try {
        const auth = await verifyRequest(req);
        if (!auth.ok) return res.status(401).json({ error: auth.error });

        const { key } = req.params;
        const { statuses, subcategories } = req.body;

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

module.exports = router;
