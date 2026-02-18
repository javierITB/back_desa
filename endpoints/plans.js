const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { syncCompanyConfiguration } = require("../utils/sas.helper");

// Helper para obtener la DB de formsdb
const getFormsDB = (req) => {
    return req.mongoClient.db("formsdb");
};

// GET /: Listar todos los planes
router.get("/", async (req, res) => {
    try {
        const db = getFormsDB(req);
        const plans = await db.collection("planes").find({}).sort({ name: 1 }).toArray();

        // Calcular cuántas empresas tienen cada plan
        const companies = await db.collection("config_empresas").find({}, { projection: { planId: 1 } }).toArray();

        const plansWithUsage = plans.map(p => {
            const usage = companies.filter(c => c.planId === p._id.toString()).length;
            return { ...p, usageCount: usage };
        });

        res.json(plansWithUsage);
    } catch (error) {
        console.error("Error fetching plans:", error);
        res.status(500).json({ error: "Error al obtener planes" });
    }
});

// POST /: Crear un nuevo plan
router.post("/", async (req, res) => {
    try {
        const { name, permissions, planLimits, price } = req.body;
        if (!name) return res.status(400).json({ error: "El nombre es requerido" });

        const db = getFormsDB(req);

        const newPlan = {
            name,
            permissions: permissions || [],
            planLimits: planLimits || {},
            price: price || 0,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection("planes").insertOne(newPlan);
        res.status(201).json({ ...newPlan, _id: result.insertedId });

    } catch (error) {
        console.error("Error creating plan:", error);
        res.status(500).json({ error: "Error al crear el plan" });
    }
});

// PUT /:id: Actualizar plan y propagar cambios
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions, planLimits, price } = req.body;
        const db = getFormsDB(req);

        if (!ObjectId.isValid(id)) return res.status(400).json({ error: "ID inválido" });

        // 1. Actualizar el Plan
        const updateResult = await db.collection("planes").findOneAndUpdate(
            { _id: new ObjectId(id) },
            {
                $set: {
                    name,
                    permissions: permissions || [],
                    planLimits: planLimits || {},
                    price: price || 0,
                    updatedAt: new Date()
                }
            },
            { returnDocument: "after" }
        );

        if (!updateResult) return res.status(404).json({ error: "Plan no encontrado" });

        const updatedPlan = updateResult;

        // 2. PROPAGACIÓN: Buscar empresas con este plan y actualizarlas
        const companies = await db.collection("config_empresas").find({ planId: id }).toArray();
        console.log(`[PlanPropagator] Propagating plan '${updatedPlan.name}' to ${companies.length} companies...`);

        // Ejecutar actualizaciones en paralelo pero controlando errores individuales
        const updatePromises = companies.map(async (comp) => {
            try {
                // A. Actualizar registro central
                await db.collection("config_empresas").updateOne(
                    { _id: comp._id },
                    {
                        $set: {
                            permissions: updatedPlan.permissions,
                            planLimits: updatedPlan.planLimits,
                            // Note: We might want to sync price to company config too if needed, 
                            // but usually price is reference data from the plan.
                            // Adding it here just in case they want to lock-in old prices per company later.
                            planPriceSnapshot: updatedPlan.price
                        }
                    }
                );

                // B. Sincronizar DB del cliente (si existe)
                await syncCompanyConfiguration(req, comp, updatedPlan.permissions, updatedPlan.planLimits);

            } catch (err) {
                console.error(`[PlanPropagator] Failed to sync company ${comp.name}:`, err);
            }
        });

        await Promise.all(updatePromises);

        res.json({
            message: "Plan actualizado y propagado correctamente",
            plan: updatedPlan,
            propagatedTo: companies.length
        });

    } catch (error) {
        console.error("Error updating plan:", error);
        res.status(500).json({ error: "Error al actualizar el plan" });
    }
});

// DELETE /:id: Eliminar plan
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const db = getFormsDB(req);

        if (!ObjectId.isValid(id)) return res.status(400).json({ error: "ID inválido" });

        // Verificar uso
        const usageCount = await db.collection("config_empresas").countDocuments({ planId: id });
        if (usageCount > 0) {
            return res.status(400).json({ error: `No se puede eliminar: Este plan está asignado a ${usageCount} empresa(s).` });
        }

        const result = await db.collection("planes").deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: "Plan no encontrado" });

        res.json({ message: "Plan eliminado correctamente" });

    } catch (error) {
        console.error("Error deleting plan:", error);
        res.status(500).json({ error: "Error al eliminar el plan" });
    }
});

module.exports = router;
