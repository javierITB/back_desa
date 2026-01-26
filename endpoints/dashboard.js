const express = require("express");
const router = express.Router();
const { validarToken } = require("../utils/validarToken.js");

// Middleware de autenticación (reutilizado)
const verifyRequest = async (req) => {
    let token = req.headers.authorization?.split(" ")[1];
    if (!token && req.body?.user?.token) token = req.body.user.token;
    if (!token && req.query?.token) token = req.query.token;

    if (!token) return { ok: false, error: "Unauthorized" };

    const valid = await validarToken(req.db, token);
    if (!valid.ok) return { ok: false, error: "Unauthorized" };

    return { ok: true, data: valid.data };
};


router.get("/metrics", async (req, res) => {
    try {
        const tokenCheck = await verifyRequest(req);
        if (!tokenCheck.ok) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        // 1. Totales
        const totalUsers = await req.db.collection("usuarios").countDocuments({ estado: { $ne: "inactivo" } });

        // 2. Obtener Todas las solicitudes
        const requests = await req.db.collection("respuestas").find(
            { status: { $ne: "archivado" } }
        ).project({
            status: 1,
            createdAt: 1,
            updatedAt: 1,
            reviewedAt: 1,
            approvedAt: 1,
            signedAt: 1
        }).toArray();

        res.json({
            success: true,
            data: {
                totalUsers,
                requests
            }
        });
    } catch (err) {
        console.error("Error en /dashboard/metrics:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
