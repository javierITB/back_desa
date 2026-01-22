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
        // Permitir acceso si el usuario es válido, idealmente filtrar por rol/empresa si es necesario
        if (!tokenCheck.ok) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        // 1. Totales
        const totalUsers = await req.db.collection("usuarios").countDocuments({ estado: { $ne: "inactivo" } });
        const totalRequests = await req.db.collection("respuestas").countDocuments({ status: { $ne: "archivado" } });



        // 2. Tiempos de Respuesta (Agregación con campos reales)
        const timeMetrics = await req.db.collection("respuestas").aggregate([
            {
                $match: {
                    status: { $ne: "archivado" },
                    $or: [
                        { status: { $in: ["revision", "en_revision"] }, reviewedAt: { $exists: true } },
                        { status: "aprobado", approvedAt: { $exists: true } },
                        { status: "firmado", signedAt: { $exists: true } },
                        { status: "finalizado" }
                    ]
                }
            },
            {
                $project: {
                    status: 1,
                    timeToReview: {
                        $cond: {
                            if: { $and: ["$reviewedAt", "$createdAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$reviewedAt" }, { $toDate: "$createdAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    },
                    timeToApprove: {
                        $cond: {
                            if: { $and: ["$approvedAt", "$createdAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$approvedAt" }, { $toDate: "$createdAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    },
                    timeToFinalize: {
                        $cond: {
                            if: { $and: ["$status", "finalizado", "$signedAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$updatedAt" }, { $toDate: "$signedAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    avgCreationToReview: { $avg: "$timeToReview" },
                    avgCreationToApprove: { $avg: "$timeToApprove" },
                    avgSignedToFinalize: { $avg: "$timeToFinalize" }
                }
            }
        ]).toArray();

        const metricsData = timeMetrics[0] || {};
        const times = {
            creationToReview: parseFloat((metricsData.avgCreationToReview || 0).toFixed(1)), // Horas
            creationToApproved: parseFloat((metricsData.avgCreationToApprove || 0).toFixed(1)),
            signedToFinalized: parseFloat((metricsData.avgSignedToFinalize || 0).toFixed(1))
        };

        // Definir fecha de referencia (1 semana atrás)
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        // 3. Tiempos de Respuesta (SEMANALES)
        const weeklyTimeMetricsArr = await req.db.collection("respuestas").aggregate([
            {
                $match: {
                    createdAt: { $gte: oneWeekAgo },
                    status: { $ne: "archivado" },
                    $or: [
                        { status: { $in: ["revision", "en_revision"] }, reviewedAt: { $exists: true } },
                        { status: "aprobado", approvedAt: { $exists: true } },
                        { status: "firmado", signedAt: { $exists: true } },
                        { status: "finalizado" }
                    ]
                }
            },
            {
                $project: {
                    status: 1,
                    timeToReview: {
                        $cond: {
                            if: { $and: ["$reviewedAt", "$createdAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$reviewedAt" }, { $toDate: "$createdAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    },
                    timeToApprove: {
                        $cond: {
                            if: { $and: ["$approvedAt", "$createdAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$approvedAt" }, { $toDate: "$createdAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    },
                    timeToFinalize: {
                        $cond: {
                            if: { $and: ["$status", "finalizado", "$signedAt"] },
                            then: { $divide: [{ $subtract: [{ $toDate: "$updatedAt" }, { $toDate: "$signedAt" }] }, 1000 * 60 * 60] },
                            else: null
                        }
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    avgCreationToReview: { $avg: "$timeToReview" },
                    avgCreationToApprove: { $avg: "$timeToApprove" },
                    avgSignedToFinalize: { $avg: "$timeToFinalize" }
                }
            }
        ]).toArray();

        const weeklyMetricsData = weeklyTimeMetricsArr[0] || {};
        const weeklyTimes = {
            creationToReview: parseFloat((weeklyMetricsData.avgCreationToReview || 0).toFixed(1)), // Horas
            creationToApproved: parseFloat((weeklyMetricsData.avgCreationToApprove || 0).toFixed(1)),
            signedToFinalized: parseFloat((weeklyMetricsData.avgSignedToFinalize || 0).toFixed(1))
        };

        // 4. Counts Semanales y tasa global

        const weeklyRequests = await req.db.collection("respuestas").countDocuments({
            createdAt: { $gte: oneWeekAgo },
            status: { $ne: "archivado" }
        });

        // Total por estado para gráficos
        const statusCounts = await req.db.collection("respuestas").aggregate([
            { $match: { status: { $ne: "archivado" } } },
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]).toArray();

        // Mapear para frontend
        const statusDistribution = statusCounts.map(s => ({
            name: s._id || 'Desconocido',
            value: s.count
        }));

        const finalizedRequests = await req.db.collection("respuestas").countDocuments({ status: "finalizado" });
        const requestsForRate = await req.db.collection("respuestas").countDocuments({ status: { $ne: "archivado" } });
        const globalRate = requestsForRate > 0 ? Math.round((finalizedRequests / requestsForRate) * 100) : 0;

        // 5. Performance Semanal de la semana anterior

        // Obtener fecha actual
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' });
        const todayStr = fmt.format(new Date()); // YYYY-MM-DD
        const [y, m, d] = todayStr.split('-').map(Number);

        // Crear objeto fecha 
        const currentSantiagoDate = new Date(y, m - 1, d, 12, 0, 0);

        // Encontrar el Lunes de esta semana
        const day = currentSantiagoDate.getDay();
        const diffToMonday = (day === 0 ? -6 : 1) - day;
        const monday = new Date(currentSantiagoDate);
        monday.setDate(currentSantiagoDate.getDate() + diffToMonday);

        monday.setDate(monday.getDate() - 7);

        // Calcular fecha inicio para la query 
        const queryStartDate = new Date(monday);
        queryStartDate.setDate(monday.getDate() - 1);

        const weeklyPerformanceRaw = await req.db.collection("respuestas").aggregate([
            {
                $match: {
                    createdAt: { $gte: queryStartDate },
                    status: { $ne: "archivado" }
                }
            },
            {
                $project: {
                    dateStr: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt",
                            timezone: "-03:00"
                        }
                    }
                }
            },
            {
                $group: {
                    _id: "$dateStr",
                    count: { $sum: 1 }
                }
            }
        ]).toArray();

        // Generar array Lun-Dom
        const daysName = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
        const weeklyPerformance = [];

        for (let i = 0; i < 7; i++) {
            const loopDate = new Date(monday);
            loopDate.setDate(monday.getDate() + i);

            // Formatear a YYYY-MM-DD manualmente para coincidir con el aggregate
            const ly = loopDate.getFullYear();
            const lm = String(loopDate.getMonth() + 1).padStart(2, '0');
            const ld = String(loopDate.getDate()).padStart(2, '0');
            const dateStr = `${ly}-${lm}-${ld}`;

            const found = weeklyPerformanceRaw.find(item => item._id === dateStr);
            weeklyPerformance.push({
                name: daysName[i],
                solicitudes: found ? found.count : 0,
                fullDate: dateStr
            });
        }

        res.json({
            success: true,
            data: {
                totalUsers,
                totalRequests,
                timeMetrics: times,
                weeklyTimeMetrics: weeklyTimes,
                weeklyRequests,
                globalRate,
                statusDistribution, // Nuevo dato
                weeklyPerformance
            }
        });
    } catch (err) {
        console.error("Error en /dashboard/metrics:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
