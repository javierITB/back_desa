const express = require('express');
const router = express.Router();
const { Groq } = require('groq-sdk');
const { validarToken } = require("../utils/validarToken.js");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LEGAL_SYSTEM_PROMPT = `Eres un Asesor Legal Virtual especializado en legislación chilena y procedimientos empresariales. Tu rol es técnico y orientativo.
Reglas de respuesta:
1. Brevedad Estricta: Respuestas cortas. Responde de forma concisa. Si la respuesta puede darse en pocas lineas o pocas palabras, hazlo así. Evita introducciones largas como "Es un placer saludarte" o conclusiones redundantes.
2. Objetividad y Tono: Mantén un tono profesional y cercano pero seco. No ofrezcas soporte emocional, opiniones personales ni consejos de vida. No eres un amigo.
3. Honestidad Técnica: Si no tienes el dato exacto o la consulta es compleja, di: "No poseo información técnica suficiente sobre este punto; consulte con un abogado especializado". Prohibido alucinar o inventar.
4. Alcance Chileno: Limítate a leyes de Chile (SII, CMF, Código del Trabajo, etc.).
5. Prohibición de Redacción: No generes borradores de contratos, demandas ni escrituras. Solo explica el procedimiento legal para obtenerlos.
6. Ambigüedad: Si la pregunta es vaga, no asumas; pide la información faltante de inmediato.`;

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

        const chatSession = await db.collection("chatbot").findOne({ uid });

        // Filtramos solo los mensajes activos para la interfaz
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

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);
        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        const uid = tokenValido.data.email;

        // Desactivamos los mensajes en el array (se mantienen para el conteo total/respaldo)
        await db.collection("chatbot").updateOne(
            { uid },
            { $set: { "messages.$[].active": false } }
        );

        res.json({ success: true, message: "Interfaz reiniciada." });
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

        const sessionToken = authHeader.split(' ')[1];
        const tokenValido = await validarToken(db, sessionToken);
        if (!tokenValido.ok) return res.status(401).json({ success: false, error: "Token inválido" });

        const { message } = req.body;
        const uid = tokenValido.data.email;

        // 1. Obtener documento del usuario para contexto
        const chatSession = await db.collection("chatbot").findOne({ uid });

        let context = [];
        if (chatSession && chatSession.messages) {
            context = chatSession.messages
                .filter(m => m.active)
                .slice(-6)
                .map(m => ({ role: m.role, content: m.content }));
        }

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

        // 3. ACTUALIZACIÓN ATÓMICA: Mensajes + Contador
        const newMessages = [
            { role: 'user', content: message, active: true, createdAt: new Date() },
            { role: 'assistant', content: aiResponse, active: true, createdAt: new Date() }
        ];

        await db.collection("chatbot").updateOne(
            { uid },
            {
                $push: { messages: { $each: newMessages } },
                $inc: { messageCount: 2 }, // Incrementamos en 2 (usuario + IA)
                $set: { lastUpdate: new Date() }
            },
            { upsert: true }
        );

        res.json({ success: true, response: aiResponse });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;