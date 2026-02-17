const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const multer = require("multer");
const { addNotification } = require("../utils/notificaciones.helper");
const { sendEmail } = require("../utils/mail.helper");
const useragent = require("useragent");
const { encrypt, createBlindIndex, verifyPassword, decrypt } = require("../utils/seguridad.helper");
const {
   registerUserUpdateEvent,
   registerUserCreationEvent,
   registerUserRemovedEvent,
   registerEmpresaCreationEvent,
   registerEmpresaUpdateEvent,
   registerEmpresaRemovedEvent,
   registerUserPasswordChange,
} = require("../utils/registerEvent");

const getAhoraChile = () => {
   const d = new Date();
   return new Date(d.toLocaleString("en-US", { timeZone: "America/Santiago" }));
};

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

const TOKEN_EXPIRATION = 12 * 1000 * 60 * 60;
const RECOVERY_CODE_EXPIRATION = 15 * 60 * 1000;

const upload = multer({
   storage: multer.memoryStorage(),
   fileFilter: function (req, file, cb) {
      if (file.mimetype.startsWith("image/")) {
         cb(null, true);
      } else {
         cb(new Error("Solo se permiten archivos de imagen"), false);
      }
   },
   limits: {
      fileSize: 2 * 1024 * 1024,
   },
});

const generateAndSend2FACode = async (db, user, type, req) => { // <--- Agregamos 'req' aquí
   let EXPIRATION_TIME;
   let subject;
   let contextMessage;

   // Definimos las variables que faltaban para corregir el ReferenceError
   const bgColor = "#f3f4f6";
   const primaryColor = "#f97316";

   if (type === "2FA_SETUP") {
      EXPIRATION_TIME = 15 * 60 * 1000;
      subject = "Código de Activación de 2FA - Acciona";
      contextMessage = "Hemos recibido una solicitud para **activar** la Autenticación de Dos Factores (2FA).";
   } else if (type === "2FA_LOGIN") {
      EXPIRATION_TIME = 5 * 60 * 1000;
      subject = "Código de Verificación de Acceso 2FA - Acciona";
      contextMessage = "Estás intentando **iniciar sesión**. Ingresa el código en el sistema.";
   } else {
      throw new Error("Tipo de código 2FA inválido.");
   }

   const verificationCode = crypto.randomInt(100000, 999999).toString();
   const expiresAt = new Date(Date.now() + EXPIRATION_TIME);
   const userId = user._id.toString();

   await db
      .collection("2fa_codes")
      .updateMany(
         { userId: userId, active: true, type: type },
         { $set: { active: false, revokedAt: new Date(), reason: "new_code_issued" } },
      );

   await db.collection("2fa_codes").insertOne({
      userId: userId,
      code: verificationCode,
      type: type,
      createdAt: new Date(),
      expiresAt: expiresAt,
      active: true,
   });

   const userEmail = decrypt(user.mail);
   const userName = decrypt(user.nombre);

   const minutes = EXPIRATION_TIME / 1000 / 60;
   const htmlContent = `
   <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: ${bgColor}; padding: 40px 10px; text-align: center;">
      <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
         
         <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px; text-align: center;">Código de Seguridad</h1>
         
         <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 25px; text-align: center;">
            Hola <strong>${userName}</strong>,<br>
            ${contextMessage}. Usa el siguiente código para continuar:
         </p>

         <div style="background-color: #f9fafb; border: 2px dashed #d1d5db; border-radius: 8px; padding: 20px; margin-bottom: 25px; text-align: center;">
            <span style="display: block; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${primaryColor}; text-align: center;">
               ${verificationCode}
            </span>
         </div>

         <p style="color: #6b7280; font-size: 14px; margin-bottom: 30px; text-align: center;">
            Este código es válido por <strong>${minutes} minutos</strong>. Si no solicitaste esta acción, puedes ignorar este correo de forma segura.
         </p>

         <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
            <p style="margin: 0;">Este es un correo automático, por favor no respondas.</p>
            <p style="margin: 5px 0 0 0;">&copy; ${new Date().getFullYear()} Plataforma Acciona.</p> 
         </div>
      </div>
   </div>
`;

   await sendEmail({
      to: userEmail,
      subject: subject,
      html: htmlContent,
   }, req); // <--- 'req' ahora ya no dará error porque lo recibimos arriba
};

// Helper para buscar token por email (compatible con cifrado)
const buscarTokenPorEmail = async (db, email) => {
   const emailIndex = createBlindIndex(email.toLowerCase().trim());
   return await db.collection("tokens").findOne({
      email_index: emailIndex,
      active: encrypt("true"),
   });
};

// Helper para crear nuevo token (con cifrado)
const crearNuevoToken = async (db, user, email) => {
   const token = crypto.randomBytes(32).toString("hex");
   const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION);
   const now = getAhoraChile();

   await db.collection("tokens").insertOne({
      token: token,
      email: encrypt(email.toLowerCase().trim()),
      email_index: createBlindIndex(email.toLowerCase().trim()),
      userId: user._id.toString(),
      rol: encrypt(user.rol),
      createdAt: now,
      expiresAt: expiresAt,
      active: encrypt("true"),
   });

   return { token, expiresAt };
};

// Helper para desactivar token por email
const desactivarTokenPorEmail = async (db, email) => {
   const emailIndex = createBlindIndex(email.toLowerCase().trim());
   const ahora = new Date();

   await db.collection("tokens").updateOne(
      {
         email_index: emailIndex,
         active: encrypt("true"),
      },
      {
         $set: {
            active: encrypt("false"),
            revokedAt: ahora,
         },
      },
   );
};

router.get("/", async (req, res) => {
   try {
      await verifyRequest(req); // Aseguramos que verifyRequest ya valida el token
      // verifyRequest devuelve { ok: true, data: { ... }, ... } si es exitoso, pero aquí parece que solo lanza error si falla.
      // Vamos a asumir que el req.headers.authorization fue validado y decodificado.
      // PERO verifyRequest en este archivo retorna validation object.
      const auth = await verifyRequest(req);
      const isRequesterMaestro = auth.data.rol?.toLowerCase() === "maestro";

      const usuarios = await req.db.collection("usuarios").find().toArray();

      if (!usuarios || usuarios.length === 0) {
         return res.status(404).json({ error: "Usuarios no encontrados" });
      }

      const usuariosProcesados = usuarios.map((u) => {
         const { pass, ...resto } = u;
         // Decrypt properties
         let cargoDescifrado = "";
         let rolDescifrado = "";
         try {
            cargoDescifrado = decrypt(u.cargo);
            rolDescifrado = u.rol; // rol usually isn't encrypted in recent versions, but check logic
         } catch (e) {
            cargoDescifrado = u.cargo;
         }

         return {
            ...resto,
            nombre: decrypt(u.nombre),
            apellido: decrypt(u.apellido),
            cargo: cargoDescifrado,
            empresa: decrypt(u.empresa),
            mail: decrypt(u.mail),
            rol: rolDescifrado
         };
      }).filter(u => {
         // FILTRO MAESTRO
         if (isRequesterMaestro) return true;
         return u.cargo?.toLowerCase() !== "maestro" && u.rol?.toLowerCase() !== "maestro";
      });

      res.status(200).json(usuariosProcesados);
   } catch (err) {
      console.error("Error al obtener usuarios:", err);
      res.status(500).json({ error: "Error al obtener usuarios" });
   }
});

router.get("/solicitud", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      const isRequesterMaestro = auth.data.rol?.toLowerCase() === "maestro";

      const usuarios = await req.db
         .collection("usuarios")
         .find({}, { projection: { nombre: 1, apellido: 1, mail: 1, empresa: 1, cargo: 1, rol: 1 } }) // Agregamos cargo/rol para filtrar
         .toArray();

      const usuariosFormateados = usuarios.map((usr) => {
         const cargo = decrypt(usr.cargo);
         return {
            nombre: decrypt(usr.nombre),
            apellido: decrypt(usr.apellido),
            correo: decrypt(usr.mail),
            empresa: decrypt(usr.empresa),
            cargo: cargo,
            rol: usr.rol
         };
      }).filter(u => {
         if (isRequesterMaestro) return true;
         return u.cargo?.toLowerCase() !== "maestro" && u.rol?.toLowerCase() !== "maestro";
      });

      res.json(usuariosFormateados);
   } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al obtener usuarios" });
   }
});

// ruta para listar cargos y empresas.  

router.get("/empresas/anuncios", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      const isRequesterMaestro = auth.data.rol?.toLowerCase() === "maestro";
      const db = req.db;

      // 1. OBTENER EMPRESAS (Descifradas)
      const empresasRaw = await db.collection("empresas").find().toArray();
      const empresas = empresasRaw.map((emp) => {
         try {
            return {
               _id: emp._id,
               nombre: (emp.nombre && emp.nombre.includes(':')) ? decrypt(emp.nombre) : emp.nombre,
            };
         } catch (e) {
            return { _id: emp._id, nombre: "Error al descifrar" };
         }
      }).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));

      // 2. OBTENER CARGOS (Desde colección roles campo "name")
      const rolesRaw = await db.collection("roles").find().toArray();
      const listaCargos = rolesRaw
         .map(r => r.name)
         .filter(Boolean)
         .filter(name => {
            // FILTRO CARGOS MAESTRO
            if (isRequesterMaestro) return true;
            return name.toLowerCase() !== "maestro";
         })
         .sort((a, b) => a.localeCompare(b, "es"));

      // 3. OBTENER USUARIOS (Para match y vista manual)
      const usuariosRaw = await db.collection("usuarios").find({ estado: "activo" }).toArray();
      const usuariosProcesados = usuariosRaw.map((u) => {
         try {
            const cargo = (u.cargo && u.cargo.includes(':')) ? decrypt(u.cargo) : u.cargo;
            return {
               _id: u._id,
               nombre: (u.nombre && u.nombre.includes(':')) ? decrypt(u.nombre) : u.nombre,
               apellido: (u.apellido && u.apellido.includes(':')) ? decrypt(u.apellido) : u.apellido,
               mail: (u.mail && u.mail.includes(':')) ? decrypt(u.mail) : u.mail,
               cargo: cargo,
               empresa: (u.empresa && u.empresa.includes(':')) ? decrypt(u.empresa) : u.empresa,
               rol: u.rol // Agregamos rol por si acaso
            };
         } catch (err) {
            return null;
         }
      }).filter(Boolean).filter(u => {
         // FILTRO USUARIOS MAESTRO
         if (isRequesterMaestro) return true;
         return u.cargo?.toLowerCase() !== "maestro" && u.rol?.toLowerCase() !== "maestro";
      });

      // RESPUESTA FINAL
      res.json({
         success: true,
         empresas,
         cargos: listaCargos, // Ahora vienen de la colección roles
         usuarios: usuariosProcesados
      });

   } catch (err) {
      console.error("Error en filtros-anuncios:", err);
      res.status(500).json({ success: false, error: "Error interno" });
   }
});


router.get("/:mail", async (req, res) => {
   try {
      await verifyRequest(req);
      const cleanMail = req.params.mail.toLowerCase().trim();

      const usr = await req.db.collection("usuarios").findOne({ mail_index: createBlindIndex(cleanMail) });

      if (!usr) {
         return res.status(404).json({ error: "Usuario no encontrado" });
      }

      res.json({
         id: usr._id,
         empresa: decrypt(usr.empresa),
         cargo: decrypt(usr.cargo || usr.rol),
      });
   } catch (err) {
      console.error("Error al obtener Usuario por mail:", err);
      res.status(500).json({ error: "Error al obtener Usuario" });
   }
});

router.get("/full/:mail", async (req, res) => {
   try {
      await verifyRequest(req);
      const { mail } = req.params;
      const mailIndex = createBlindIndex(mail.toLowerCase().trim());

      const usr = await req.db.collection("usuarios").findOne(
         {
            mail_index: mailIndex,
         },
         {
            projection: {
               _id: 1,
               nombre: 1,
               apellido: 1,
               mail: 1,
               empresa: 1,
               cargo: 1,
               rol: 1,
               notificaciones: 1,
               twoFactorEnabled: 1,
               estado: 1,
            },
         },
      );

      if (!usr) return res.status(404).json({ error: "Usuario no encontrado" });

      if (!usr.notificaciones) {
         usr.notificaciones = [];
      }

      const usuarioDesencriptado = {
         _id: usr._id,
         nombre: decrypt(usr.nombre),
         apellido: decrypt(usr.apellido),
         mail: decrypt(usr.mail),
         empresa: decrypt(usr.empresa),
         cargo: decrypt(usr.cargo),
         rol: usr.rol,
         notificaciones: usr.notificaciones,
         twoFactorEnabled: usr.twoFactorEnabled,
         estado: usr.estado,
      };

      res.json(usuarioDesencriptado);
   } catch (err) {
      console.error("Error en /full/:mail:", err);
      res.status(500).json({ error: "Error al obtener Usuario completo" });
   }
});

router.post("/login", async (req, res) => {
   const { email, password } = req.body;

   if (!email || !password) {
      return res.status(400).json({ success: false, message: "Datos incompletos" });
   }

   try {
      const normalizedEmail = email.toLowerCase().trim();

      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(normalizedEmail),
      });

      if (!user || !(await verifyPassword(user.pass, password))) {
         return res.status(401).json({ success: false, message: "Credenciales inválidas" });
      }

      if (user.estado === "pendiente") {
         return res.status(401).json({
            success: false,
            message: "Usuario pendiente de activación. Revisa tu correo.",
         });
      }

      if (user.estado === "inactivo") {
         return res.status(401).json({
            success: false,
            message: "Usuario inactivo. Contacta al administrador.",
         });
      }

      if (user.twoFactorEnabled === true) {
         try {
            await generateAndSend2FACode(req.db, user, "2FA_LOGIN", req);
         } catch (mailError) {
            console.error("Error enviando 2FA login:", mailError);
            return res.status(500).json({
               success: false,
               message: "Error enviando código 2FA: " + (mailError.message || "Error desconocido"),
            });
         }

         return res.json({
            success: true,
            twoFA: true,
            userId: user._id.toString(),
            email: normalizedEmail,
            message: "Se requiere código 2FA. Enviado a tu correo.",
         });
      }

      const now = getAhoraChile();

      let finalToken = null;
      let expiresAt = null;

      // Buscar token existente usando email_index
      const existingToken = await buscarTokenPorEmail(req.db, normalizedEmail);

      if (existingToken) {
         // Descifrar expiresAt y verificar
         const expiresAtDescifrado = existingToken.expiresAt;
         if (new Date(expiresAtDescifrado) > now) {
            finalToken = existingToken.token;
            expiresAt = expiresAtDescifrado;
         } else {
            // Token expirado, desactivarlo
            await desactivarTokenPorEmail(req.db, normalizedEmail);
         }
      }

      if (!finalToken) {
         // Crear nuevo token
         const nuevoToken = await crearNuevoToken(req.db, user, normalizedEmail);
         finalToken = nuevoToken.token;
         expiresAt = nuevoToken.expiresAt;
      }

      let nombre = "";
      let apellido = "";
      let rol = "";
      try {
         nombre = decrypt(user.nombre);
         apellido = user.apellido ? decrypt(user.apellido) : "";
         rol = decrypt(user.cargo);
      } catch {
         nombre = user.nombre || "";
         apellido = user.apellido || "";
         rol = user.cargo || "";
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const agent = useragent.parse(req.headers["user-agent"] || "Desconocido");

      await req.db.collection("ingresos").insertOne({
         usr: {
            name: nombre,
            email: normalizedEmail,
            cargo: user.rol,
            rol: rol,
            userId: user._id.toString(),
         },
         ipAddress,
         os: agent.os?.toString?.() || "Desconocido",
         browser: agent.toAgent?.() || "Desconocido",
         now,
      });

      return res.json({
         success: true,
         token: finalToken,
         usr: {
            name: nombre,
            lastName: apellido,
            email: normalizedEmail,
            cargo: user.rol,
            rol: rol,
            userId: user._id.toString(),
         },
      });
   } catch (err) {
      console.error("Error en login:", err);
      return res.status(500).json({ error: "Error interno en login" });
   }
});

router.post("/verify-login-2fa", async (req, res) => {
   const { email, verificationCode } = req.body;

   if (!email || !verificationCode || verificationCode.length !== 6) {
      return res.status(400).json({
         success: false,
         message: "Datos incompletos o código inválido.",
      });
   }

   const now = new Date();

   try {
      // Buscar usuario por email (usando blind index)
      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(email.toLowerCase().trim()),
      });

      if (!user) {
         return res.status(401).json({
            success: false,
            message: "Usuario no encontrado.",
         });
      }

      const userId = user._id.toString();

      // Buscar código 2FA activo para LOGIN
      const codeRecord = await req.db.collection("2fa_codes").findOne({
         userId: userId,
         code: verificationCode,
         type: "2FA_LOGIN",
         active: true,
         expiresAt: { $gt: now },
      });

      if (!codeRecord) {
         // Verificar si hay códigos pero expirados
         const expiredCode = await req.db.collection("2fa_codes").findOne({
            userId: userId,
            code: verificationCode,
            type: "2FA_LOGIN",
         });

         if (expiredCode) {
            console.log("DEBUG: Código encontrado pero expirado o inactivo");
            return res.status(401).json({
               success: false,
               message: "Código 2FA expirado. Solicita uno nuevo.",
            });
         }

         return res.status(401).json({
            success: false,
            message: "Código 2FA incorrecto.",
         });
      }

      // Marcar código como usado
      await req.db.collection("2fa_codes").updateOne({ _id: codeRecord._id }, { $set: { active: false, usedAt: now } });

      // Lógica de tokens (compatible con cifrado)
      let finalToken = null;
      let expiresAt = null;
      const userEmail = decrypt(user.mail);
      const rol = decrypt(user.cargo);

      // Buscar token existente
      const existingTokenRecord = await buscarTokenPorEmail(req.db, userEmail);

      if (existingTokenRecord) {
         // Verificar si está activo y no expirado
         const expiresAtDescifrado = existingTokenRecord.expiresAt;
         if (new Date(expiresAtDescifrado) > now) {
            finalToken = existingTokenRecord.token;
            expiresAt = expiresAtDescifrado;
         } else {
            // Token expirado, desactivarlo
            await desactivarTokenPorEmail(req.db, userEmail);
         }
      }

      if (!finalToken) {
         // Crear nuevo token
         const nuevoToken = await crearNuevoToken(req.db, user, userEmail);
         finalToken = nuevoToken.token;
         expiresAt = nuevoToken.expiresAt;
      }

      // Registrar ingreso
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgentString = req.headers["user-agent"] || "Desconocido";
      const agent = useragent.parse(userAgentString);

      const userName = decrypt(user.nombre);
      const usr = {
         name: userName,
         email: userEmail,
         rol: rol,
         cargo: user.rol,
         userId: userId,
      };

      await req.db.collection("ingresos").insertOne({
         usr,
         ipAddress,
         os: agent.os.toString(),
         browser: agent.toAgent(),
         now: now,
      });

      return res.json({
         success: true,
         token: finalToken,
         usr,
      });
   } catch (err) {
      console.error("Error en verify-login-2fa:", err);
      return res.status(500).json({
         success: false,
         message: "Error interno en la verificación 2FA.",
      });
   }
});

router.post("/recuperacion", async (req, res) => {
   const { email } = req.body;
   try {
      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(email.toLowerCase().trim()),
      });

      if (!user || user.estado === "inactivo") {
         return res.status(404).json({ message: "No disponible." });
      }

      const code = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + RECOVERY_CODE_EXPIRATION);

      const userEmail = decrypt(user.mail);

      await req.db
         .collection("recovery_codes")
         .updateMany({ email: userEmail, active: true }, { $set: { active: false } });

      await req.db.collection("recovery_codes").insertOne({
         email: userEmail,
         code,
         userId: user._id.toString(),
         createdAt: new Date(),
         expiresAt,
         active: true,
      });

      // --- CONFIGURACIÓN VISUAL DEL CORREO ---
      const primaryColor = "#2563eb"; // Azul elegante
      const bgColor = "#f3f4f6"; // Gris claro de fondo

      // CAMBIO AQUÍ: Llamamos a sendEmail pasando 'req' al final
      await sendEmail({
         to: userEmail,
         subject: "Restablecer Contraseña",
         html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: ${bgColor}; padding: 40px 10px; text-align: center;">
               <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
                  
                  <h1 style="color: #1f2937; font-size: 24px; margin-bottom: 20px; text-align: center;">Restablecer Contraseña</h1>
                  
                  <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 25px; text-align: center;">
                     Hola, hemos recibido una solicitud para restablecer la contraseña de tu cuenta. 
                     Usa el siguiente código de seguridad:
                  </p>

                  <div style="background-color: #f9fafb; border: 2px dashed #d1d5db; border-radius: 8px; padding: 20px; margin-bottom: 25px; text-align: center;">
                     <span style="display: block; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${primaryColor}; text-align: center;">
                        ${code}
                     </span>
                  </div>

                  <p style="color: #6b7280; font-size: 14px; margin-bottom: 30px; text-align: center;">
                     Este código es válido por 15 minutos. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.
                  </p>

                  <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
                     <p style="margin: 0;">Este es un correo automático, por favor no respondas a este mensaje.</p>
                     <p style="margin: 5px 0 0 0;">&copy; ${new Date().getFullYear()} Plataforma Acciona</p> 
                  </div>
               </div>
            </div>
         `,
      }, req);

      res.json({ success: true, message: "Enviado." });
   } catch (err) {
      console.error("Error en recuperación:", err);
      res.status(500).json({ error: "Error interno" });
   }
});

router.post("/borrarpass", async (req, res) => {
   const { email, code, password } = req.body;
   const now = new Date();

   if (!email || !code || !password) {
      return res.status(400).json({
         message: "Correo, código y nueva contraseña son obligatorios.",
      });
   }

   try {
      const recoveryRecord = await req.db.collection("recovery_codes").findOne({
         email: email.toLowerCase().trim(),
         code,
         active: true,
      });

      if (!recoveryRecord) {
         return res.status(401).json({
            message: "Código inválido o ya utilizado.",
         });
      }

      if (recoveryRecord.expiresAt < now) {
         await req.db
            .collection("recovery_codes")
            .updateOne({ _id: recoveryRecord._id }, { $set: { active: false, revokedAt: now, reason: "expired" } });

         return res.status(401).json({
            message: "Código expirado. Solicita uno nuevo.",
         });
      }

      const userId = recoveryRecord?.userId;

      if (!userId) {
         return res.status(500).json({
            message: "Error interno: usuario no asociado al código.",
         });
      }

      const { hashPassword } = require("../utils/seguridad.helper");
      const hashedPassword = await hashPassword(password);

      const updateUserResult = await req.db.collection("usuarios").updateOne(
         { _id: ObjectId.createFromHexString(String(userId)) },
         {
            $set: {
               pass: hashedPassword,
               updatedAt: now.toISOString(),
            },
         },
      );

      if (updateUserResult.matchedCount === 0) {
         return res.status(404).json({
            message: "Usuario no encontrado.",
         });
      }

      await req.db.collection("recovery_codes").updateOne(
         { _id: recoveryRecord._id },
         {
            $set: {
               active: false,
               revokedAt: now,
               reason: "consumed",
            },
         },
      );

      return res.json({
         success: true,
         uid: userId,
      });
   } catch (err) {
      console.error("Error en /borrarpass:", err);
      return res.status(500).json({
         message: "Error interno al cambiar la contraseña.",
      });
   }
});

router.post("/send-2fa-code", async (req, res) => {
   try {
      const { email } = req.body;

      if (!email) {
         return res.status(400).json({
            message: "Email requerido.",
         });
      }

      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(email.toLowerCase().trim()),
      });

      if (!user) {
         return res.status(404).json({
            message: "Usuario no encontrado.",
         });
      }

      await generateAndSend2FACode(req.db, user, "2FA_SETUP", req);

      res.status(200).json({
         success: true,
         message: "Código de activación 2FA enviado a tu correo.",
      });
   } catch (err) {
      console.error("Error en /send-2fa-code:", err);
      res.status(500).json({
         success: false,
         message: "Error interno al procesar la solicitud.",
      });
   }
});

router.post("/verify-2fa-activation", async (req, res) => {
   const { email, verificationCode } = req.body;

   if (!email || !verificationCode || verificationCode.length !== 6) {
      return res.status(400).json({
         success: false,
         message: "Datos incompletos o código inválido.",
      });
   }

   try {
      // Buscar usuario por email (usando blind index)
      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(email.toLowerCase().trim()),
      });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: "Usuario no encontrado.",
         });
      }

      const userId = user._id.toString();

      // Buscar código 2FA activo
      const codeRecord = await req.db.collection("2fa_codes").findOne({
         userId: userId,
         code: verificationCode,
         type: "2FA_SETUP",
         active: true,
         expiresAt: { $gt: new Date() },
      });

      if (!codeRecord) {
         return res.status(400).json({
            success: false,
            message: "Código incorrecto o expirado.",
         });
      }

      // Marcar código como usado
      await req.db
         .collection("2fa_codes")
         .updateOne({ _id: codeRecord._id }, { $set: { active: false, usedAt: new Date() } });

      // Actualizar estado 2FA del usuario
      await req.db.collection("usuarios").updateOne({ _id: new ObjectId(userId) }, { $set: { twoFactorEnabled: true } });

      res.status(200).json({
         success: true,
         message: "Autenticación de Dos Factores activada exitosamente.",
      });
   } catch (err) {
      console.error("Error en /verify-2fa-activation:", err);
      res.status(500).json({
         success: false,
         message: "Error interno en la verificación.",
      });
   }
});

// RUTA /disable-2fa TOKENIZADA - CONSISTENTE CON EL RESTO
router.post("/disable-2fa", async (req, res) => {
   const { email } = req.body;

   if (!email) {
      return res.status(400).json({ error: "Bad request" });
   }

   try {
      // ==================== 1. VALIDAR TOKEN (MISMA LÓGICA QUE TODAS) ====================
      const tokenCheck = await verifyRequest(req);

      if (!tokenCheck.ok) {
         return res.status(401).json({ error: "Unauthorized" });
      }

      const emailNormalizado = email.toLowerCase().trim();

      // ==================== 2. VERIFICAR CORRESPONDENCIA EMAIL ====================
      if (tokenCheck.data.email !== emailNormalizado) {
         return res.status(401).json({ error: "Unauthorized" });
      }

      // ==================== 3. BUSCAR USUARIO ====================
      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(emailNormalizado),
      });

      if (!user) {
         return res.status(404).json({ error: "Not found" });
      }

      if (!user.twoFactorEnabled) {
         return res.status(400).json({ error: "Bad request" });
      }

      // ==================== 4. DESHABILITAR 2FA ====================
      const userId = user._id.toString();

      await req.db
         .collection("usuarios")
         .updateOne({ _id: new ObjectId(userId) }, { $set: { twoFactorEnabled: false } });

      // Invalidar códigos 2FA activos
      await req.db
         .collection("2fa_codes")
         .updateMany(
            { userId: userId, active: true },
            { $set: { active: false, revokedAt: new Date(), reason: "2fa_disabled" } },
         );

      // ==================== 5. REGISTRAR ACCIÓN ====================
      try {
         await req.db.collection("security_logs").insertOne({
            action: "2FA_DISABLED",
            userId: userId,
            email: emailNormalizado,
            timestamp: new Date(),
            ip: req.ip,
            userAgent: req.headers["user-agent"],
         });
      } catch (logError) {
         console.error("Error registrando en logs:", logError);
      }

      res.status(200).json({
         success: true,
         message: "2FA disabled successfully",
      });
   } catch (err) {
      console.error("Error en /disable-2fa:", err);
      res.status(500).json({ error: "Internal server error" });
   }
});

router.get("/logins/todos", async (req, res) => {
   try {
      await verifyRequest(req); 

      const dbContext = req.db; 

      const tkn = await dbContext.collection("ingresos").find().toArray();
      
      res.json(tkn);
   } catch (err) {
      // Log para debuggear en consola del servidor qué está fallando
      console.error("Error en /logins/todos:", err.message);

      if (err.status) {
         return res.status(err.status).json({ message: err.message });
      }
      res.status(500).json({ error: "Error al obtener ingresos" });
   }
});

router.post("/validate", async (req, res) => {
   const { token, email, cargo } = req.body;

   if (!token || !email || !cargo) return res.status(401).json({ valid: false, message: "Acceso inválido" });

   try {
      // Buscar token (el campo 'token' no está cifrado)
      const tokenRecord = await req.db.collection("tokens").findOne({
         token,
      });

      if (!tokenRecord) {
         console.log("Token no encontrado en BD");
         return res.status(401).json({
            valid: false,
            message: "Token inválido o inexistente",
         });
      }

      // 1. Verificar si está activo (descifrar campo 'active')
      let activeDescifrado = "false"; // Por defecto

      try {
         if (tokenRecord.active && tokenRecord.active.includes(":")) {
            activeDescifrado = decrypt(tokenRecord.active);
         }
      } catch (error) {
         console.error("Error descifrando active:", error);
         return res.status(401).json({
            valid: false,
            message: "Error en formato del token",
         });
      }

      if (activeDescifrado !== "true") {
         return res.status(401).json({
            valid: false,
            message: "Token inactivo o revocado",
         });
      }

      console.log("Token está activo ");

      // 2. Verificar expiración
      const now = new Date();
      const expiresAt = new Date(tokenRecord.expiresAt);

      if (expiresAt < now) {
         // Desactivar token (cifrar como "false")
         await req.db.collection("tokens").updateOne(
            { token },
            {
               $set: {
                  active: encrypt("false"),
                  revokedAt: new Date(),
               },
            },
         );

         return res.status(401).json({
            valid: false,
            message: "Token expirado. Inicia sesión nuevamente.",
         });
      }

      console.log("Token NO expirado ");

      // 3. Verificar email del token
      let tokenEmailDescifrado = "";
      try {
         if (tokenRecord.email && tokenRecord.email.includes(":")) {
            tokenEmailDescifrado = decrypt(tokenRecord.email);
         }
      } catch (error) {
         console.error("Error descifrando email del token:", error);
         return res.status(401).json({
            valid: false,
            message: "Error en formato del token",
         });
      }

      const emailNormalizado = email.toLowerCase().trim();
      if (tokenEmailDescifrado !== emailNormalizado) {
         return res.status(401).json({
            valid: false,
            message: "Token no corresponde al usuario",
         });
      }

      console.log("Email coincide ");

      // 4. Verificar rol del token
      let tokenRolDescifrado = "";
      try {
         if (tokenRecord.rol && tokenRecord.rol.includes(":")) {
            tokenRolDescifrado = decrypt(tokenRecord.rol);
         }
      } catch (error) {
         console.error("Error descifrando rol del token:", error);
         return res.status(401).json({
            valid: false,
            message: "Error en formato del token",
         });
      }

      if (tokenRolDescifrado !== cargo) {
         return res.status(401).json({
            valid: false,
            message: "Cargo no corresponde al usuario",
         });
      }

      console.log("Rol coincide ");
      console.log("Token VALIDADO EXITOSAMENTE");

      return res.json({
         valid: true,
         user: {
            email: emailNormalizado,
            cargo,
         },
      });
   } catch (err) {
      console.error("Error validando token:", err);
      res.status(500).json({
         valid: false,
         message: "Error interno al validar token",
         error: err.message,
      });
   }
});

router.post("/logout", async (req, res) => {
   const { token } = req.body;
   if (!token) return res.status(400).json({ success: false, message: "Token requerido" });

   try {
      await req.db.collection("tokens").updateOne(
         { token },
         {
            $set: {
               active: encrypt("false"), // Cifrar como string "false"
               revokedAt: new Date(),
            },
         },
      );
      res.json({ success: true, message: "Sesión cerrada" });
   } catch (err) {
      console.error("Error cerrando sesión:", err);
      res.status(500).json({ success: false, message: "Error interno al cerrar sesión" });
   }
});

router.post("/register", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }
      const { nombre, apellido, mail, empresa, cargo, rol, estado } = req.body;
      const m = mail.toLowerCase().trim();

      const isRequesterMaestro = auth.data.rol?.toLowerCase() === "maestro";
      if ((cargo?.toLowerCase() === "maestro" || rol?.toLowerCase() === "maestro") && !isRequesterMaestro) {
         return res.status(403).json({ error: "No tienes permisos para crear usuarios Maestro." });
      }

      if (await req.db.collection("usuarios").findOne({ mail_index: createBlindIndex(m) })) {
         return res.status(400).json({ error: "El usuario ya existe" });
      }

      // PLAN LIMITES USUARIOS
      const { checkPlanLimits } = require("../utils/planLimits");
      try {
         await checkPlanLimits(req, 'users', { empresa });
      } catch (limitErr) {
         return res.status(403).json({ error: limitErr.message });
      }

      const newUser = {
         nombre: encrypt(nombre),
         apellido: encrypt(apellido),
         mail: encrypt(m),
         mail_index: createBlindIndex(m),
         empresa: encrypt(empresa),
         cargo: encrypt(cargo),
         rol,
         pass: "",
         estado: estado || "pendiente",
         twoFactorEnabled: false,
         createdAt: new Date().toISOString(),
         updatedAt: new Date().toISOString(),
      };

      const result = await req.db.collection("usuarios").insertOne(newUser);
      const userId = result.insertedId.toString();

      // --- NOTIFICACIÓN Y EMAIL ---

      // 1. Notificación en DB
      await addNotification(req.db, {
         userId: userId,
         titulo: `Registro Exitoso!`,
         descripcion: `Bienvenid@ a nuestra plataforma!`,
         prioridad: 2,
         color: "#7afb24ff",
         icono: "User",
      });

      // 2. Envío de Email usando tu helper sendEmail
      try {
         const htmlContent = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
               <h2 style="color: #3B82F6;">¡Bienvenido, ${nombre}!</h2>
               <p>Has sido registrado en la plataforma. Para activar tu cuenta, haz clic en el botón:</p>
               <div style="text-align: center; margin: 30px 0;">
                  <a href="${req.urlPortal}/set-password?userId=${userId}"
                     style="background-color: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                     Configurar mi Contraseña
                  </a>
               </div>
               <p style="font-size: 12px; color: #666;">Empresa: ${req.nombreEmpresa}</p>
               <p>© ${new Date().getFullYear()} Plataforma Acciona.</p>

            </div>`;

         // Llamamos a tu helper directamente
         await sendEmail({
            to: m,
            subject: "Completa tu registro",
            html: htmlContent,
         }, req);
      } catch (mailError) {
         console.error("Error enviando email:", mailError);
      }

      registerUserCreationEvent(req, auth, req.body);
      res.status(201).json({ success: true, message: "Usuario registrado y correo enviado", userId });
   } catch (err) {
      res.status(500).json({ error: "Error al registrar" });
   }
});

router.post("/set-initial-password", async (req, res) => {
   try {
      const { userId, password } = req.body;

      if (!userId || !password) {
         return res.status(400).json({ error: "Datos incompletos" });
      }

      // Usamos createFromHexString para evitar el error de "deprecado"
      const user = await req.db.collection("usuarios").findOne({
         _id: ObjectId.createFromHexString(String(userId)),
      });

      if (!user || user.estado !== "pendiente" || user.pass !== "") {
         return res.status(403).json({ error: "El enlace ha expirado o ya es inválido" });
      }

      // Usamos tus helpers de seguridad
      const { hashPassword } = require("../utils/seguridad.helper");
      const hashedPassword = await hashPassword(password);

      await req.db.collection("usuarios").updateOne(
         { _id: ObjectId.createFromHexString(String(userId)) },
         {
            $set: {
               pass: hashedPassword,
               estado: "activo",
               updatedAt: new Date().toISOString(),
            },
         },
      );

      res.json({ success: true, message: "Contraseña creada exitosamente" });
   } catch (err) {
      res.status(500).json({ error: "Error al procesar la solicitud" });
   }
});

router.post("/change-password", async (req, res) => {
   const { email, currentPassword, newPassword } = req.body;

   if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Faltan datos requeridos" });
   }

   try {
      const user = await req.db.collection("usuarios").findOne({
         mail_index: createBlindIndex(email.toLowerCase().trim()),
      });

      if (!user) {
         return res.status(404).json({ success: false, message: "Usuario no encontrado" });
      }

      if (!(await verifyPassword(user.pass, currentPassword))) {
         return res.status(401).json({ success: false, message: "La contraseña actual es incorrecta" });
      }

      if (newPassword.length < 8) {
         return res
            .status(400)
            .json({ success: false, message: "La nueva contraseña debe tener al menos 8 caracteres" });
      }

      const hashPassword = require("../utils/seguridad.helper").hashPassword;
      const hashedNewPassword = await hashPassword(newPassword);

      if (await verifyPassword(user.pass, newPassword)) {
         return res.status(400).json({ success: false, message: "La nueva contraseña no puede ser igual a la actual" });
      }

      const result = await req.db.collection("usuarios").updateOne(
         { _id: user._id },
         {
            $set: {
               pass: hashedNewPassword,
               updatedAt: new Date().toISOString(),
            },
         },
      );

      if (result.modifiedCount === 0) {
         return res.status(500).json({ success: false, message: "No se pudo actualizar la contraseña" });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      await addNotification(req.db, {
         userId: user._id.toString(),
         titulo: `Cambio de Contraseña`,
         descripcion: `La contraseña fue actualizada exitosamente el ${new Date().toLocaleString()}. IP: ${ipAddress}`,
         prioridad: 2,
         color: "#ffae00",
         icono: "Shield",
      });

      registerUserPasswordChange(req, user);
      res.json({ success: true, message: "Contraseña actualizada exitosamente" });
   } catch (err) {
      console.error("Error cambiando contraseña:", err);
      res.status(500).json({ success: false, message: "Error interno del servidor" });
   }
});

router.put("/users/:id", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }
      const { nombre, apellido, mail, empresa, cargo, rol, estado } = req.body;
      const userId = req.params.id;

      const isRequesterMaestro = auth.data.rol?.toLowerCase() === "maestro";

      // 1. Check Maestro Role
      if ((cargo?.toLowerCase() === "maestro" || rol?.toLowerCase() === "maestro") && !isRequesterMaestro) {
         return res.status(403).json({ error: "No tienes permisos para asignar el rol Maestro." });
      }

      if (!nombre || !apellido || !mail || !empresa || !cargo || !rol) {
         return res.status(400).json({ error: "Todos los campos son obligatorios" });
      }

      const encrypt = require("../utils/seguridad.helper").encrypt;
      const userEmail = mail.toLowerCase().trim();
      const mailIndex = createBlindIndex(userEmail);

      const existingUser = await req.db.collection("usuarios").findOne({
         mail_index: mailIndex,
         _id: { $ne: new ObjectId(userId) },
      });

      if (existingUser) {
         return res.status(400).json({ error: "El email ya está en uso por otro usuario" });
      }

      // 2. Check Editar Maestro
      let currentCargo = "";
      try {
         // Intentar descifrar el cargo del usuario actual para validación
         const userToCheck = await req.db.collection("usuarios").findOne({ _id: new ObjectId(userId) });
         if (userToCheck) {
            currentCargo = decrypt(userToCheck.cargo);
         }
      } catch (e) {
         console.warn("Error descifrando cargo en validación PUT:", e);
      }

      if (currentCargo?.toLowerCase() === "maestro" && !isRequesterMaestro) {
         return res.status(403).json({ error: "No tienes permisos para editar usuarios Maestro." });
      }

      const updateData = {
         nombre: encrypt(nombre),
         apellido: encrypt(apellido),
         mail: encrypt(userEmail),
         mail_index: mailIndex,
         empresa: encrypt(empresa),
         cargo: encrypt(cargo),
         rol,
         estado,
         updatedAt: new Date().toISOString(),
      };

      const result = await req.db.collection("usuarios").updateOne({ _id: new ObjectId(userId) }, { $set: updateData });

      if (result.matchedCount === 0) {
         return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const ahora = new Date();
      // Desactivar token usando email_index (compatible con cifrado)
      const emailIndex = createBlindIndex(userEmail);
      await req.db.collection("tokens").updateOne(
         {
            email_index: emailIndex,
            active: encrypt("true"),
         },
         {
            $set: {
               active: encrypt("false"),
               revokedAt: ahora,
            },
         },
      );

      registerUserUpdateEvent(req, auth, req.body);

      res.json({
         success: true,
         message: "Usuario actualizado exitosamente",
         updatedFields: updateData,
      });
   } catch (err) {
      console.error("Error actualizando usuario:", err);
      if (err.message.includes("ObjectId")) {
         return res.status(400).json({ error: "ID de usuario inválido" });
      }
      res.status(500).json({ error: "Error interno al actualizar usuario" });
   }
});

router.delete("/users/:id", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }

      const userId = req?.params?.id;

      if (!ObjectId.isValid(userId)) {
         return res.status(400).json({ error: "ID inválido" });
      }
      const deletedUser = await req.db.collection("usuarios").findOneAndDelete({
         _id: new ObjectId(userId),
      });

      if (!deletedUser) {
         return res.status(404).json({ error: "Usuario no encontrado" });
      }

      registerUserRemovedEvent(req, auth, deletedUser);

      res.json({
         message: "Usuario eliminado exitosamente",
         deletedUser,
      });
   } catch (err) {
      console.error("Error eliminando usuario:", err);
      res.status(500).json({ error: "Error al eliminar usuario: " + err.message });
   }
});

router.post("/set-password", async (req, res) => {
   try {
      const { userId, password } = req.body;
      if (!userId || !password) {
         return res.status(400).json({ error: "UserId y contraseña son requeridos" });
      }

      if (password.length < 8) {
         return res.status(400).json({
            error: "La contraseña debe tener al menos 8 caracteres",
         });
      }

      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);

      if (!hasLetter || !hasNumber) {
         return res.status(400).json({
            error: "La contraseña debe incluir letras y números",
         });
      }

      if (password.length > 64) {
         return res.status(400).json({
            error: "La contraseña es demasiado larga",
         });
      }

      const commonPasswords = ["12345678", "password", "contraseña", "admin123", "qwerty123"];
      if (commonPasswords.includes(password.toLowerCase())) {
         return res.status(400).json({
            error: "La contraseña es demasiado común. Elige una más segura",
         });
      }

      const existingUser = await req.db.collection("usuarios").findOne({
         _id: new ObjectId(userId),
      });

      if (!existingUser) {
         return res.status(404).json({ error: "Usuario no encontrado" });
      }

      // --- VALIDACIÓN SOLICITADA ---
      // Solo funciona si el estado es pendiente y la contraseña está vacía
      if (existingUser.estado !== "pendiente" || (existingUser.pass && existingUser.pass !== "")) {
         return res.status(403).json({
            error: "La contraseña ya fue establecida o el enlace ha expirado",
         });
      }

      const hashPassword = require("../utils/seguridad.helper").hashPassword;
      const hashed = await hashPassword(password);

      const result = await req.db
         .collection("usuarios")
         .updateOne(
            { _id: new ObjectId(userId) },
            { $set: { pass: hashed, estado: "activo", updatedAt: new Date().toISOString() } },
         );

      if (result.matchedCount === 0) {
         return res.status(400).json({
            error: "No se pudo actualizar la contraseña. El usuario no fue encontrado o el ID es incorrecto.",
         });
      }

      res.json({
         success: true,
         message: "Contraseña establecida exitosamente",
      });
   } catch (error) {
      console.error("Error al establecer contraseña:", error);
      if (error.message.includes("ObjectId")) {
         return res.status(400).json({ error: "ID de usuario inválido" });
      }
      res.status(500).json({ error: "Error interno del servidor" });
   }
});

router.get("/empresas/todas", async (req, res) => {
   try {
      await verifyRequest(req);
      const empresas = await req.db.collection("empresas").find().toArray();

      const empresasDescifradas = empresas.map((emp) => {
         // Descifrar campos de texto
         const empresaDescifrada = {
            _id: emp._id,
            nombre: decrypt(emp.nombre),
            rut: decrypt(emp.rut),
            direccion: decrypt(emp.direccion),
            encargado: decrypt(emp.encargado),
            rut_encargado: decrypt(emp.rut_encargado),
            createdAt: emp.createdAt,
            updatedAt: emp.updatedAt,
            logo: null,
         };

         // Si tiene logo, procesarlo
         if (emp.logo && emp.logo.fileData) {
            try {
               // El fileData está cifrado como Base64, necesitamos descifrarlo
               const fileDataDescifrado = decrypt(emp.logo.fileData);

               empresaDescifrada.logo = {
                  fileName: emp.logo.fileName,
                  fileData: fileDataDescifrado, // Base64 descifrado
                  fileSize: emp.logo.fileSize,
                  mimeType: emp.logo.mimeType,
                  uploadedAt: emp.logo.uploadedAt,
               };
            } catch (error) {
               console.error("Error procesando logo para empresa", emp._id, error);
               // Mantener metadata pero sin fileData
               empresaDescifrada.logo = {
                  fileName: emp.logo.fileName,
                  fileSize: emp.logo.fileSize,
                  mimeType: emp.logo.mimeType,
                  uploadedAt: emp.logo.uploadedAt,
                  error: "No se pudo descifrar",
               };
            }
         } else if (emp.logo) {
            // Si hay logo metadata pero no fileData (por si acaso)
            empresaDescifrada.logo = {
               fileName: emp.logo.fileName,
               fileSize: emp.logo.fileSize,
               mimeType: emp.logo.mimeType,
               uploadedAt: emp.logo.uploadedAt,
               note: "Sin datos de imagen",
            };
         }

         return empresaDescifrada;
      });

      // --- CAMBIO SOLICITADO: Ordenar alfabéticamente por nombre ---
      empresasDescifradas.sort((a, b) => {
         return (a.nombre || "").localeCompare(b.nombre || "", "es", { sensitivity: "base" });
      });

      res.json(empresasDescifradas);
   } catch (err) {
      console.error("Error al obtener empresas:", err);
      res.status(500).json({ error: "Error al obtener empresas" });
   }
});

router.get("/empresas/logo", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }

      const empresaEmail = auth?.data?.email;

      if (!empresaEmail) {
         return res.status(404).json({ error: "Email no encontrado" });
      }

      const userData = await req.db.collection("usuarios").findOne({ mail_index: createBlindIndex(empresaEmail) });

      if (!userData) {
         return res.status(404).json({ error: "Usuario no encontrado" });
      }

      const empresaNameDecrypted = decrypt(userData.empresa);

      const empresa = await req.db.collection("empresas").findOne(
         { nombre_index: createBlindIndex(empresaNameDecrypted) },
         {
            projection: {
               "logo.fileData": 1,
               "logo.mimeType": 1,
            },
         },
      );

      if (!empresa?.logo?.fileData) {
         return res.status(404).json({ error: "Logo no encontrado" });
      }

      const logoBase64 = decrypt(empresa?.logo?.fileData);

      res.json({
         logo: logoBase64,
         mimeType: empresa?.logo?.mimeType || "image/png",
      });
   } catch (err) {
      console.error("Error obteniendo logo empresa:", err);
      res.status(500).json({ error: "Error obteniendo logo" });

   }
});

router.get("/empresas/:id", async (req, res) => {
   try {
      await verifyRequest(req);
      const empresa = await req.db.collection("empresas").findOne({
         _id: new ObjectId(req.params.id),
      });

      if (!empresa) return res.status(404).json({ error: "Empresa no encontrada" });

      const descifrada = {
         ...empresa,
         nombre: decrypt(empresa.nombre),
         rut: decrypt(empresa.rut),
         direccion: decrypt(empresa.direccion),
         encargado: decrypt(empresa.encargado),
         rut_encargado: decrypt(empresa.rut_encargado),
      };

      if (descifrada.logo && descifrada.logo.fileData) {
         descifrada.logo.fileData = decrypt(descifrada.logo.fileData);
      }

      res.json(descifrada);
   } catch (err) {
      res.status(500).json({ error: "Error al obtener empresa" });
   }
});

router.post("/empresas/register", upload.single("logo"), async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }

      // Plan Limites Empresas
      const { checkPlanLimits } = require("../utils/planLimits");
      try {
         await checkPlanLimits(req, 'companies');
      } catch (limitErr) {
         return res.status(403).json({ error: limitErr.message });
      }

      const { nombre, rut, direccion, encargado, rut_encargado } = req.body;
      if (!nombre || !rut) return res.status(400).json({ error: "Nombre y RUT obligatorios" });

      const nombreLimpio = nombre.trim();
      const rutLimpio = rut.trim();

      const empresaExistente = await req.db.collection("empresas").findOne({
         $or: [{ nombre_index: createBlindIndex(nombreLimpio) }, { rut_index: createBlindIndex(rutLimpio) }],
      });

      if (empresaExistente) {
         return res.status(400).json({ error: "Ya existe una empresa con ese nombre o RUT" });
      }

      const empresaData = {
         nombre: encrypt(nombreLimpio),
         nombre_index: createBlindIndex(nombreLimpio),
         rut: encrypt(rutLimpio),
         rut_index: createBlindIndex(rutLimpio),
         direccion: encrypt(direccion || ""),
         encargado: encrypt(encargado || ""),
         rut_encargado: encrypt(rut_encargado || ""),
         createdAt: new Date(),
         updatedAt: new Date(),
      };

      if (req.file) {
         empresaData.logo = {
            fileName: req.file.originalname,
            fileData: encrypt(req.file.buffer.toString("base64")),
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            uploadedAt: new Date(),
         };
      }

      registerEmpresaCreationEvent(req, auth, req.body);

      const result = await req.db.collection("empresas").insertOne(empresaData);
      res.status(201).json({ success: true, id: result.insertedId });
   } catch (err) {
      res.status(500).json({ error: "Error al registrar: " + err.message });
   }
});

router.put("/empresas/:id", upload.single("logo"), async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }
      const { nombre, rut, direccion, encargado, rut_encargado } = req.body;
      const id = new ObjectId(req.params.id);

      const updateData = {
         nombre: encrypt(nombre.trim()),
         nombre_index: createBlindIndex(nombre.trim()),
         rut: encrypt(rut.trim()),
         rut_index: createBlindIndex(rut.trim()),
         direccion: encrypt(direccion || ""),
         encargado: encrypt(encargado || ""),
         rut_encargado: encrypt(rut_encargado || ""),
         updatedAt: new Date(),
      };

      if (req.file) {
         updateData.logo = {
            fileName: req.file.originalname,
            fileData: encrypt(req.file.buffer.toString("base64")),
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            uploadedAt: new Date(),
         };
      } else if (req.body.logo === "DELETE_LOGO") {
         updateData.logo = null;
      }

      const result = await req.db.collection("empresas").updateOne({ _id: id }, { $set: updateData });
      if (result.matchedCount === 0) return res.status(404).json({ error: "No encontrada" });

      registerEmpresaUpdateEvent(req, auth, req.body);

      res.json({ success: true, message: "Empresa actualizada" });
   } catch (err) {
      res.status(500).json({ error: "Error al actualizar" });
   }
});

router.delete("/empresas/:id", async (req, res) => {
   try {
      const auth = await verifyRequest(req);
      if (!auth.ok) {
         return res.status(403).json({ error: auth.error });
      }

      const empresaId = new ObjectId(req.params.id);
      const deletedEmpresa = await req.db.collection("empresas").findOneAndDelete({ _id: empresaId });

      if (!deletedEmpresa) return res.status(404).json({ error: "Empresa no encontrada" });

      registerEmpresaRemovedEvent(req, auth, deletedEmpresa);

      res.json({ message: "Empresa eliminada exitosamente" });
   } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      res.status(500).json({ error: "Error al eliminar" });
   }
});
// ruta para recopilar todos los usuarios de la empresa asociados a un email

router.get("/empresas/usuarios/:email", async (req, res) => {
   try {
      await verifyRequest(req);
      const emailABuscar = req.params.email;

      // 1. OBTENEMOS TODOS LOS USUARIOS
      // Necesario para poder desencriptar y comparar el nombre de la empresa correctamente
      const todosLosUsuarios = await req.db.collection("usuarios").find().toArray();

      // 2. IDENTIFICAR AL USUARIO PIVOTE
      const hashBusqueda = createBlindIndex(emailABuscar.toLowerCase().trim());
      const usuarioPivote = todosLosUsuarios.find((u) => u.mail_index === hashBusqueda);

      if (!usuarioPivote) {
         return res.status(404).json({ success: false, message: "Usuario no encontrado" });
      }

      // Desencriptamos la empresa del pivote para tener la referencia de comparación
      const empresaReferencia = decrypt(usuarioPivote.empresa);

      // 3. FILTRADO POST-DESENCRIPTACIÓN Y FORMATEO
      const usuariosProcesados = todosLosUsuarios
         .filter((u) => {
            try {
               // Comparamos el texto plano de la empresa (evita errores por IV distinto)
               return decrypt(u.empresa) === empresaReferencia;
            } catch (e) {
               return false;
            }
         })
         .map((u) => ({
            id: u._id.toString(),
            nombre: u.nombre ? decrypt(u.nombre) : "",
            apellido: u.apellido ? decrypt(u.apellido) : "",
            mail: u.mail ? decrypt(u.mail) : "",
         }));

      res.json({
         success: true,
         count: usuariosProcesados.length,
         data: usuariosProcesados,
      });
   } catch (err) {
      console.error("Error al listar usuarios de empresa:", err);
      if (err.status) return res.status(err.status).json({ message: err.message });
      res.status(500).json({ error: "Error al obtener la lista de empresa" });
   }
});

router.get("/mantenimiento/migrar-empresas-pqc", async (req, res) => {
   try {
      const empresas = await req.db.collection("empresas").find().toArray();
      let cont = 0;
      let logosProcesados = 0;
      let logosConError = 0;
      let logosYaCifrados = 0;

      for (let emp of empresas) {
         const updates = {};
         let procesado = false;

         // 1. Cifrar campos de texto
         if (emp.nombre && !emp.nombre.includes(":")) {
            updates.nombre = encrypt(emp.nombre);
            updates.nombre_index = createBlindIndex(emp.nombre);
            procesado = true;
            console.log(`   Nombre cifrado`);
         }

         if (emp.rut && !emp.rut.includes(":")) {
            updates.rut = encrypt(emp.rut);
            updates.rut_index = createBlindIndex(emp.rut);
            procesado = true;
            console.log(`   RUT cifrado`);
         }

         if (emp.direccion && !emp.direccion.includes(":")) {
            updates.direccion = encrypt(emp.direccion);
            procesado = true;
            console.log(`   Dirección cifrada`);
         }

         if (emp.encargado && !emp.encargado.includes(":")) {
            updates.encargado = encrypt(emp.encargado);
            procesado = true;
            console.log(`   Encargado cifrado`);
         }

         if (emp.rut_encargado && !emp.rut_encargado.includes(":")) {
            updates.rut_encargado = encrypt(emp.rut_encargado);
            procesado = true;
            console.log(`   RUT encargado cifrado`);
         }

         // 2. Cifrar logo (LA PARTE IMPORTANTE)
         if (emp.logo && emp.logo.fileData) {
            // Verificar si ya está cifrado
            if (typeof emp.logo.fileData === "string" && emp.logo.fileData.includes(":")) {
               console.log(`   Logo ya cifrado, saltando`);
               logosYaCifrados++;
               continue;
            }

            try {
               let base64Str;

               // MANEJO DEL BINARY (igual que el endpoint PUT)
               if (emp.logo.fileData && emp.logo.fileData.buffer) {
                  // Caso 1: Es un Binary de MongoDB con buffer
                  console.log(`  Tipo: Binary con buffer`);
                  base64Str = Buffer.from(emp.logo.fileData.buffer).toString("base64");
               } else if (emp.logo.fileData._bsontype === "Binary") {
                  // Caso 2: Es un Binary de MongoDB (driver viejo)
                  console.log(`  Tipo: Binary (_bsontype)`);
                  base64Str = emp.logo.fileData.toString("base64");
               } else if (Buffer.isBuffer(emp.logo.fileData)) {
                  // Caso 3: Es un Buffer puro
                  console.log(`  Tipo: Buffer`);
                  base64Str = emp.logo.fileData.toString("base64");
               } else if (typeof emp.logo.fileData === "string") {
                  // Caso 4: Ya es string Base64
                  console.log(`  Tipo: String Base64`);

                  // Verificar si ya es Base64 válido
                  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(emp.logo.fileData);
                  if (isBase64) {
                     base64Str = emp.logo.fileData;
                  } else {
                     console.log(`   String no es Base64 válido, intentando convertir...`);
                     // Intentar tratar como binary string
                     base64Str = Buffer.from(emp.logo.fileData, "binary").toString("base64");
                  }
               } else {
                  logosConError++;
                  continue;
               }

               // Verificar que tenemos Base64 válido
               if (!base64Str || !/^[A-Za-z0-9+/]+=*$/.test(base64Str.substring(0, 100))) {
                  console.log(`   Base64 no válido generado`);
                  logosConError++;
                  continue;
               }

               // CIFRAR (igual que el endpoint PUT)
               const fileDataCifrado = encrypt(base64Str);

               // Verificar cifrado
               if (!fileDataCifrado || !fileDataCifrado.includes(":")) {
                  console.log(`   Cifrado falló`);
                  logosConError++;
                  continue;
               }

               updates["logo.fileData"] = fileDataCifrado;
               logosProcesados++;
               procesado = true;
               console.log(`   Logo cifrado exitosamente`);
            } catch (error) {
               console.error(`   Error procesando logo:`, error.message);
               logosConError++;
               // No actualizar el logo si hay error
            }
         }

         // Actualizar en BD si hay cambios
         if (procesado && Object.keys(updates).length > 0) {
            try {
               await req.db.collection("empresas").updateOne({ _id: emp._id }, { $set: updates });
               cont++;
               console.log(`   Empresa actualizada en BD`);
            } catch (dbError) {
               console.error(`   Error actualizando BD:`, dbError.message);
            }
         } else {
            console.log(`   Sin cambios, saltando`);
         }
      }

      console.log(`\n=== MIGRACIÓN COMPLETADA ===`);

      res.json({
         success: true,
         message: `Empresas migradas: ${cont}/${empresas.length}`,
         estadisticas: {
            totalEmpresas: empresas.length,
            empresasProcesadas: cont,
            logosProcesados,
            logosConError,
            logosYaCifrados,
            empresasSinCambios: empresas.length - cont,
         },
         nota: "Los logos ahora están cifrados igual que en el endpoint PUT /empresas/:id",
      });
   } catch (err) {
      console.error("Error en migración V3:", err);
      res.status(500).json({
         success: false,
         error: err.message,
         stack: err.stack,
      });
   }
});

router.get("/mantenimiento/migrar-tokens-pqc", async (req, res) => {
   try {
      const tokens = await req.db.collection("tokens").find().toArray();
      let cont = 0;

      for (let tokenDoc of tokens) {
         const updates = {};

         if (tokenDoc.email && !tokenDoc.email.includes(":")) {
            updates.email = encrypt(tokenDoc.email);
            updates.email_index = createBlindIndex(tokenDoc.email);
         }

         if (tokenDoc.rol && !tokenDoc.rol.includes(":")) {
            updates.rol = encrypt(tokenDoc.rol);
         }

         if (tokenDoc.active !== undefined && tokenDoc.active !== null) {
            if (typeof tokenDoc.active === "string" && tokenDoc.active.includes(":")) {
               // Ya está cifrado, no hacer nada
            } else if (typeof tokenDoc.active === "boolean") {
               const activeStr = tokenDoc.active.toString();
               updates.active = encrypt(activeStr);
            } else if (typeof tokenDoc.active === "string" && !tokenDoc.active.includes(":")) {
               updates.active = encrypt(tokenDoc.active);
            }
         }

         if (Object.keys(updates).length > 0) {
            await req.db.collection("tokens").updateOne({ _id: tokenDoc._id }, { $set: updates });
            cont++;
         }
      }

      res.json({
         success: true,
         message: `Tokens migrados: ${cont}/${tokens.length}`,
         total: tokens.length,
         migrados: cont,
         nota: "Se añadió email_index para búsquedas por email",
      });
   } catch (err) {
      console.error("Error migrando tokens:", err);
      res.status(500).json({ error: err.message });
   }
});

module.exports = router;
