const express = require('express');
const router = express.Router();
const { Groq } = require('groq-sdk');
const { validarToken } = require("../utils/validarToken.js");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LEGAL_SYSTEM_PROMPT = `Eres un Asesor Legal Virtual especializado en legislación chilena y procedimientos empresariales. Tu rol es técnico y orientativo.

Reglas de respuesta:
1. Brevedad Estricta: Responde de forma concisa.
2. Objetividad y Tono: Tono profesional, seco y sin emotividad.
3. Honestidad Técnica: Si no sabes algo, admítelo. Prohibido inventar.
4. Alcance Chileno: Solo legislación de Chile (SII, CMF, Código del Trabajo, etc.).
5. Prohibición de Redacción: No generes documentos, solo explica procedimientos.`;

// ==================== ENDPOINT: OBTENER HISTORIAL ====================
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

        const uid = tokenValido.data.email;

        // Buscamos el documento único del usuario
        const chatSession = await db.collection("chatbot").findOne({ uid });

        // Retornamos solo los mensajes que están marcados como activos
        const history = chatSession ? chatSession.messages.filter(m => m.active) : [];

        res.json({ success: true, history });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ENDPOINT: LIMPIAR CHAT ====================
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

        const uid = tokenValido.data.email;

        // Marcamos todos los mensajes actuales como activos: false
        await db.collection("chatbot").updateOne(
            { uid },
            { $set: { "messages.$[].active": false } }
        );

        res.json({ success: true, message: "Historial archivado correctamente." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ENDPOINT: ENVIAR MENSAJE ====================
router.post('/', async (req, res) => {
    try {
        const { checkPlanLimits } = require("../utils/planLimits");
        try {
            await checkPlanLimits(req, "bot_messages", null);
        } catch (limitErr) {
            return res.status(403).json({ error: limitErr.message });
        }

        const db = req.db;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: "Token requerido" });
        }

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);
        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        const { message } = req.body;
        const uid = tokenValido.data.email;

        // 1. Obtener solo los últimos mensajes ACTIVOS para el contexto de Groq
        const chatSession = await db.collection("chatbot").findOne({ uid });

        let contextMessages = [];
        if (chatSession && chatSession.messages) {
            contextMessages = chatSession.messages
                .filter(m => m.active)
                .slice(-6) // Limitamos a los últimos 6 para ahorrar tokens
                .map(m => ({ role: m.role, content: m.content }));
        }

        const messagesForGroq = [
            { role: "system", content: LEGAL_SYSTEM_PROMPT },
            ...contextMessages,
            { role: "user", content: message }
        ];

        // 2. Consultar a Groq
        const completion = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: messagesForGroq,
            temperature: 0.2
        });

        const aiResponse = completion.choices[0].message.content;

        // 3. Actualizar el documento del usuario (Push de nuevos mensajes)
        const newMessages = [
            { role: 'user', content: message, active: true, createdAt: new Date() },
            { role: 'assistant', content: aiResponse, active: true, createdAt: new Date() }
        ];

        await db.collection("chatbot").updateOne(
            { uid },
            {
                $push: { messages: { $each: newMessages } },
                $set: { lastUpdate: new Date() }
            },
            { upsert: true } // Si no existe el registro del usuario, lo crea
        );

        res.json({ success: true, response: aiResponse });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;