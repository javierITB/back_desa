const express = require('express');
const router = express.Router();
const { Groq } = require('groq-sdk');

const { validarToken } = require("../utils/validarToken.js");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LEGAL_SYSTEM_PROMPT = `Eres un Asesor Legal Virtual especializado en legislación chilena y procedimientos empresariales. Tu rol es técnico y orientativo.

Reglas de respuesta:
1. Brevedad Estricta: Responde de forma concisa. Si la respuesta puede darse en dos párrafos o una lista de puntos, hazlo así. Evita introducciones largas como "Es un placer saludarte" o conclusiones redundantes.
2. Objetividad y Tono: Mantén un tono profesional y cercano pero seco. No ofrezcas soporte emocional, opiniones personales ni consejos de vida. No eres un amigo.
3. Honestidad Técnica: Si no tienes el dato exacto o la consulta es compleja, di: "No poseo información técnica suficiente sobre este punto; consulte con un abogado especializado". Prohibido alucinar o inventar.
4. Alcance Chileno: Limítate a leyes de Chile (SII, CMF, Código del Trabajo, etc.).
5. Prohibición de Redacción: No generes borradores de contratos, demandas ni escrituras. Solo explica el procedimiento legal para obtenerlos.
6. Ambigüedad: Si la pregunta es vaga, no asumas; pide la información faltante de inmediato.`;

// ==================== ENDPOINT: OBTENER HISTORIAL (GET) ====================
router.get('/history', async (req, res) => {
    try {
        const db = req.db;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Token requerido" });
        }

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);

        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        // Buscamos solo los mensajes ACTIVOS del usuario (uid basado en su email o id)
        const history = await db.collection("chatbot")
            .find({ uid: tokenValido.data.email, active: true })
            .sort({ createdAt: 1 })
            .toArray();

        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ENDPOINT: LIMPIAR CHAT (POST) ====================
router.post('/clear', async (req, res) => {
    try {
        const db = req.db;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Token requerido" });
        }

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);
        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        // Desactivamos los mensajes pero NO los borramos de la DB
        await db.collection("chatbot").updateMany(
            { uid: tokenValido.data.email, active: true },
            { $set: { active: false } }
        );

        res.json({ success: true, message: "Chat reiniciado. Respaldo conservado." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ENDPOINT: ENVIAR MENSAJE (POST) ====================
router.post('/', async (req, res) => {
    try {
        const db = req.db;
        if (!db) return res.status(500).json({ success: false, error: 'Error de conexión' });

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Token de autenticación requerido." });
        }

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);
        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: "Mensaje vacío" });

        const uid = tokenValido.data.email;

        // 1. Obtener contexto previo de la DB (Solo activos)
        const lastMessages = await db.collection("chatbot")
            .find({ uid, active: true })
            .sort({ createdAt: -1 })
            .limit(6)
            .toArray();

        // Los invertimos para que queden en orden cronológico para Groq
        const context = lastMessages.reverse().map(m => ({ role: m.role, content: m.content }));

        const messagesForGroq = [
            { role: "system", content: LEGAL_SYSTEM_PROMPT },
            ...context,
            { role: "user", content: message }
        ];

        // 2. Llamada a Groq
        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: messagesForGroq,
            temperature: 0.2
        });

        const aiResponse = completion.choices[0].message.content;

        // 3. Guardar en DB la interacción
        const logs = [
            { uid, role: 'user', content: message, active: true, createdAt: new Date() },
            { uid, role: 'assistant', content: aiResponse, active: true, createdAt: new Date() }
        ];
        await db.collection("chatbot").insertMany(logs);

        res.json({
            success: true,
            response: aiResponse
        });

    } catch (error) {
        console.error('ERROR CHATBOT:', error);
        res.status(500).json({ success: false, error: 'Error interno', detalle: error.message });
    }
});

module.exports = router;