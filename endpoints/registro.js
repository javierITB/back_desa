const express = require("express");
const router = express.Router();

const verifyRequest = async (req) => {
   const authHeader = req.headers.authorization;

   if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw { status: 401, message: "No autorizado" };
   }
   const token = authHeader.split(" ")[1];

   const { validarToken } = require("../utils/validarToken");
   const validation = await validarToken(req.db, token);
   if (!validation.ok) {
      throw { status: 401, message: "Acceso denegado: " + validation.reason };
   }
   return validation;
};

router.get("/todos", async (req, res) => {
   try {
      await verifyRequest(req);
      const tkn = await req.db.collection("cambios").find().toArray();
      res.json(tkn);
   } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      res.status(500).json({ error: "Error al obtener registros" });
   }
});

module.exports = router;