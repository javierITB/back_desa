// mail.helper.js
const nodemailer = require("nodemailer");
const { isEmail } = require("validator");

// --- CONFIGURACIÓN SMTP ---
const MAIL_CREDENTIALS = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

const MAX_RECIPIENTS = 10;

// --- INICIALIZACIÓN DEL TRANSPORTER ---
const transporter = nodemailer.createTransport({
  host: MAIL_CREDENTIALS.host,
  port: MAIL_CREDENTIALS.port,
  secure: MAIL_CREDENTIALS.secure,
  auth: MAIL_CREDENTIALS.auth,
});

// Verificación de conexión al iniciar
transporter.verify((error, success) => {
  if (error) {
    console.error(" Error al conectar al SMTP:", error);
  } else {
    console.log(" Servidor SMTP listo para enviar correos");
  }
});

// --- LÓGICA DE VALIDACIÓN (Interna) ---
function validarDestinatarios(raw) {
  if (!raw) return { error: "Campo 'to' requerido." };
  let lista = [];

  if (Array.isArray(raw)) lista = raw;
  else if (typeof raw === "string") {
    lista = raw.split(/\s*[;,]\s*/).filter(Boolean);
    if (lista.length === 0 && raw.trim()) lista = [raw.trim()];
  } else {
    return { error: "El campo 'to' debe ser string o array." };
  }

  if (lista.length > MAX_RECIPIENTS)
    return { error: `Máximo ${MAX_RECIPIENTS} destinatarios permitidos.` };

  for (const email of lista) {
    if (!isEmail(email)) return { error: `Email inválido: ${email}` };
  }

  return { lista };
}

// --- FUNCIÓN PRINCIPAL EXPORTADA ---
/**
 * Procesa y envía un correo electrónico.
 * @param {Object} data - { to, subject, html, text, from }
 * @returns {Promise<Object>} Resultado del envío o lanza un error
 */
// --- FUNCIÓN PRINCIPAL EXPORTADA ---
// --- FUNCIÓN PRINCIPAL EXPORTADA ---
const sendEmail = async ({ to, subject, html, text, from }) => {
  // 1. Validar destinatarios
  const valid = validarDestinatarios(to);
  if (valid.error) throw { status: 400, message: valid.error };

  // 2. Validar contenido
  if (!subject) throw { status: 400, message: "Campo 'subject' requerido." };
  if (!html && !text) throw { status: 400, message: "Debe incluir 'html' o 'text'." };

  // --- LÓGICA DE NOMBRE DE EMPRESA ---
  // Si recibimos "api", lo cambiamos a "ACCIONA". Si no, usamos el global.
  const tenantRaw = global.currentTenant || "Plataforma";
  const tenantName = (tenantRaw === "api") ? "ACCIONA" : tenantRaw;
  const nombreEmpresa = tenantName.toUpperCase();

  // Estilo que combina con 'Segoe UI' del correo original, centrado y elegante
  const empresaHtml = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; text-align: center;">
      ${nombreEmpresa}
    </div>`;

  // --- INYECCIÓN DENTRO DEL RECUADRO BLANCO ---
  // Buscamos el segundo <div> del HTML. 
  // El primero es el fondo gris, el segundo es el cuadro blanco (max-width: 500px).
  // Insertamos el nombre justo después de que se abra ese segundo contenedor.
  let htmlConEmpresa = html;
  if (html) {
    const divs = html.split(/(<div[^>]*>)/i);
    if (divs.length >= 5) { 
      // divs[0] = previo
      // divs[1] = opening div 1 (fondo gris)
      // divs[2] = contenido intermedio
      // divs[3] = opening div 2 (cuadro blanco) -> Aquí inyectamos
      divs[3] = divs[3] + empresaHtml;
      htmlConEmpresa = divs.join('');
    } else {
      // Fallback por si la estructura cambia, lo mete al inicio del primer div
      htmlConEmpresa = html.replace(/(<div[^>]*>)/i, `$1${empresaHtml}`);
    }
  }

  // 3. Construir opciones
  const mailOptions = {
    from: from || MAIL_CREDENTIALS.auth.user,
    to: valid.lista.join(", "),
    subject: subject,
    html: htmlConEmpresa,
    text: text ? `${nombreEmpresa}\n\n${text}` : text,
  };

  // 4. Enviar
  try {
    const info = await transporter.sendMail(mailOptions);
    return { ok: true, messageId: info.messageId, response: info.response };
  } catch (err) {
    console.error("Error interno en Nodemailer:", err);
    throw { status: 500, message: "Fallo interno al enviar correo." };
  }
};
module.exports = { sendEmail };