const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { createBlindIndex } = require("../utils/seguridad.helper");

// Importar TU función validarToken
const { validarToken } = require("../utils/validarToken.js");

// Helper para verificar token en cualquier request - SOLO CAMBIO DE MENSAJES
const verifyRequest = async (req) => {
  let token = req.headers.authorization?.split(" ")[1];

  // Fallback: buscar en body.user.token
  if (!token && req.body?.user?.token) token = req.body.user.token;

  // Fallback: buscar en query param
  if (!token && req.query?.token) token = req.query.token;

  if (!token) return { ok: false, error: "Unauthorized" };

  const valid = await validarToken(req.db, token);
  if (!valid.ok) return { ok: false, error: "Unauthorized" }; 

  return { ok: true, data: valid.data };
};

router.use(express.json({ limit: '4mb' }));

// Crear o actualizar un formulario - SOLO CAMBIO DE MENSAJES DE ERROR
router.post("/", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const data = req.body;

    // PROCESAR PREGUNTAS para asegurar configuraciones de archivos
    const processedQuestions = (data.questions || []).map(question => {
      if (question.type === 'file') {
        return {
          ...question,
          multiple: question.multiple || false,
          accept: question.accept || '.pdf,application/pdf',
          maxSize: question.maxSize || '1'
        };
      }
      return question;
    });

    const formData = {
      ...data,
      questions: processedQuestions,
      updatedAt: new Date()
    };

    let result;

    if (!data.id) {
      // INSERT
      result = await req.db.collection("forms").insertOne({
        ...formData,
        createdAt: new Date()
      });

      res.status(201).json({
        _id: result.insertedId,
        ...formData
      });
    } else {
      // UPDATE
      result = await req.db.collection("forms").findOneAndUpdate(
        { _id: new ObjectId(data.id) },
        { $set: formData },
        { returnDocument: "after" }
      );

      if (!result) {
        return res.status(404).json({ error: "Not found" }); 
      }

      res.status(200).json(result.value || result);
    }

  } catch (err) {
    console.error("Error en POST /forms:", err);
    res.status(500).json({ error: "Internal server error" }); 
  }
});

// Listar todos los formularios - SOLO CAMBIO DE MENSAJES DE ERROR
router.get("/", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const forms = await req.db.collection("forms").find().toArray();
    res.json(forms);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" }); 
  }
});

// Obtener un formulario por ID - SOLO CAMBIO DE MENSAJES DE ERROR
router.get("/:id", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const form = await req.db
      .collection("forms")
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!form) return res.status(404).json({ error: "Not found" });
    res.json(form);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

//Filtrado de forms por seccion y empresa - SOLO CAMBIO DE MENSAJES DE ERROR
router.get("/section/:section/:mail", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const { section, mail } = req.params;

    // 1. Buscar la empresa asociada al usuario usando BLIND INDEX
    const user = await req.db.collection("usuarios").findOne({ 
      mail_index: createBlindIndex(mail) 
    });

    if (!user || !user.empresa) {
      return res.status(404).json({ error: "Not found" }); 
    }

    const empresaUsuario = user.empresa; 

    // 2. Definir la consulta de filtrado
    const query = {
      section: section,
      status: "publicado", 
      $or: [
        { companies: empresaUsuario }, 
        { companies: "Todas" }         
      ],
    };

    // 3. Buscar formularios que cumplan todas las condiciones
    const forms = await req.db
      .collection("forms")
      .find(query)
      .toArray();

    if (!forms || forms.length === 0) { 
      return res.status(404).json({ error: "Not found" });
    }

    res.status(200).json(forms);
  } catch (err) {
    console.error("Error al obtener formularios filtrados:", err);
    res.status(500).json({ error: "Internal server error" }); 
  }
});

// Actualizar un formulario 
router.put("/:id", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const data = req.body;

    const processedQuestions = (data.questions || []).map(question => {
      if (question.type === 'file') {
        return {
          ...question,
          multiple: question.multiple || false,
          accept: question.accept || '.pdf,application/pdf',
          maxSize: question.maxSize || '1'
        };
      }
      return question;
    });

    const result = await req.db.collection("forms").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          ...data,
          questions: processedQuestions,
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );

    if (!result) return res.status(404).json({ error: "Not found" }); 
    res.json(result.value || result);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" }); 
  }
});

// Publicar un formulario
router.put("/public/:id", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const result = await req.db.collection("forms").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: "publicado",
          updatedAt: new Date()
        }
      },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({ error: "Not found" }); 
    }

    res.status(200).json(result.value);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" }); 
  }
});

// Eliminar un formulario -
router.delete("/:id", async (req, res) => {
  try {
    // Validar token con el helper
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }

    const result = await req.db
      .collection("forms")
      .deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Not found" }); 
    }

    res.status(200).json({ message: "Deleted" }); 
  } catch (err) {
    res.status(500).json({ error: "Internal server error" }); 
  }
});

router.post("/respuestas", async (req, res) => {
  try {
    const tokenCheck = await verifyRequest(req);
    if (!tokenCheck.ok) {
      return res.status(401).json({ error: "Unauthorized" }); 
    }
    
    const result = await req.db.collection("respuestas").insertOne({
      ...req.body,
      createdAt: new Date()
    });

    res.json({ _id: result.insertedId, ...req.body });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" }); 
  }
});

module.exports = router;