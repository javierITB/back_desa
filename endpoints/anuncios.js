// endpoints/anuncios.js
const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const { addNotification } = require("../utils/notificaciones.helper");
const { createBlindIndex, decrypt } = require("../utils/seguridad.helper");
const { sendEmail } = require("../utils/mail.helper");

// Importar TU función validarToken tal como está
const { validarToken } = require("../utils/validarToken.js");

router.post('/', async (req, res) => {

  try {
    const db = req.db;

    if (!db) {
      console.error('No hay conexión a la base de datos');
      return res.status(500).json({
        success: false,
        error: 'Error de conexión a la base de datos'
      });
    }

    // ==================== 1. VALIDAR TOKEN ====================
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log("DEBUG anuncios: Falta Authorization header");
      return res.status(401).json({
        success: false,
        error: "Token de autenticación requerido."
      });
    }

    const sessionToken = authHeader.split(' ')[1];

    // Usar TU función validarToken EXACTAMENTE COMO ESTÁ
    const tokenValido = await validarToken(db, sessionToken);

    if (!tokenValido.ok) {
      return res.status(401).json({
        success: false,
        error: `Token inválido: ${tokenValido.reason}`
      });
    }

    const tokenData = tokenValido.data;

    // ==================== 2. BUSCAR USUARIO COMPLETO ====================
    const user = await db.collection("usuarios").findOne({
      mail_index: createBlindIndex(tokenData.email.toLowerCase().trim())
    });

    if (!user) {
      console.log("DEBUG anuncios: Usuario no encontrado en BD");
      return res.status(401).json({
        success: false,
        error: "Usuario no encontrado."
      });
    }

    if (user.estado !== 'activo') {
      return res.status(401).json({
        success: false,
        error: "Usuario inactivo. Contacta al administrador."
      });
    }



    // ==================== 3. CONTINUAR CON LA LÓGICA ORIGINAL ====================
    // TODO TU CÓDIGO ORIGINAL AQUÍ (todo lo que ya tenías después de las validaciones)
    const {
      titulo,
      descripcion,
      prioridad = 1,
      color = '#f5872dff',
      icono = 'paper',
      actionUrl = null,
      destinatarios,
      enviarCorreo = false,
      enviarNotificacion = true
    } = req.body;

    const urlNotificaciones = actionUrl || req.urlPortal;

    if (!titulo || !descripcion) {
      console.log('Validación fallida: título o descripción faltante');
      return res.status(400).json({
        success: false,
        error: 'Título y descripción son requeridos'
      });
    }

    if (!destinatarios || !destinatarios.tipo) {
      console.log('Validación fallida: destinatarios faltante');
      return res.status(400).json({
        success: false,
        error: 'Debe especificar destinatarios'
      });
    }

    if (!enviarCorreo && !enviarNotificacion) {
      console.log('Validación fallida: ningún método de envío seleccionado');
      return res.status(400).json({
        success: false,
        error: 'Debe seleccionar al menos un método de envío (notificación o correo)'
      });
    }



    let resultadoEnvio;
    const fechaEnvio = new Date();

    if (destinatarios.tipo === 'todos') {
      console.log('Enviando a TODOS los usuarios activos');

      resultadoEnvio = await addNotification(db, {
        filtro: { estado: 'activo' },
        titulo,
        descripcion,
        prioridad,
        color,
        icono,
        actionUrl
      });

      if (enviarCorreo) {
        const usuarios = await db
          .collection("usuarios")
          .find({ estado: "activo", mail: { $exists: true } })
          .project({ mail: 1 })
          .toArray();


        for (const usuarioItem of usuarios) {
          if (usuarioItem.mail) {
            try {
              const emailDecrypted = decrypt(usuarioItem.mail);

              if (emailDecrypted && emailDecrypted.includes('@')) {
                await sendEmail({
                  to: emailDecrypted,
                  subject: titulo,
                  html: `
                  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; padding: 40px 10px; text-align: center;">
                      <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
                          
                          <h1 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; font-weight: 700;">
                              Nueva Notificación
                          </h1>

                          <div style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 30px; text-align: left;">
                              ${descripcion}
                          </div>

                          <div style="text-align: center; margin-bottom: 20px;">
                              <a href="${urlNotificaciones}" 
                                style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                                  Ver notificación en la plataforma
                              </a>
                          </div>

                          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
                              <p style="margin: 0;">Este es un aviso automático de la plataforma.</p>
                              <p>© ${new Date().getFullYear()} Plataforma Acciona.</p>
                          </div>
                      </div>
                  </div>
                  `
                },req);
              }
            } catch (emailError) {
              console.error("Error enviando correo");

            }
          }
        }
      }


    } else if (destinatarios.tipo === 'filtro') {

      const filtro = destinatarios.filtro || {};
      const condicionesFiltro = { estado: 'activo' };

      const andConditions = [];

      if (filtro.empresas && filtro.empresas.length > 0) {
        andConditions.push({ empresa: { $in: filtro.empresas } });
      }

      if (filtro.cargos && filtro.cargos.length > 0) {
        andConditions.push({ cargo: { $in: filtro.cargos } });
      }

      if (filtro.roles && filtro.roles.length > 0) {
        andConditions.push({ rol: { $in: filtro.roles } });
      }

      if (andConditions.length > 0) {
        condicionesFiltro.$and = andConditions;
      }


      resultadoEnvio = await addNotification(db, {
        filtro: condicionesFiltro,
        titulo,
        descripcion,
        prioridad,
        color,
        icono,
        actionUrl
      });

      if (enviarCorreo) {
        const usuarios = await db
          .collection("usuarios")
          .find(condicionesFiltro)
          .project({ mail: 1 })
          .toArray();


        for (const usuarioItem of usuarios) {
          if (usuarioItem.mail) {
            try {
              const emailDecrypted = decrypt(usuarioItem.mail);

              if (emailDecrypted && emailDecrypted.includes('@')) {
                await sendEmail({
                  to: emailDecrypted,
                  subject: titulo,
                  html:`
                  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; padding: 40px 10px; text-align: center;">
                      <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
                          
                          <h1 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; font-weight: 700;">
                              Nueva Notificación
                          </h1>

                          <div style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 30px; text-align: left;">
                              ${descripcion}
                          </div>

                          <div style="text-align: center; margin-bottom: 20px;">
                              <a href="${urlNotificaciones}" 
                                style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                                  Ver notificación en la plataforma
                              </a>
                          </div>

                          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
                              <p style="margin: 0;">Este es un aviso automático de la plataforma.</p>
                              <p>© ${new Date().getFullYear()} Plataforma Acciona.</p>
                          </div>
                      </div>
                  </div>
                  `
                }, req);
              }
            } catch (emailError) {
              console.error("Error enviando correo:", emailError.message);
            }
          }
        }
      }


    } else if (destinatarios.tipo === 'manual') {

      if (!destinatarios.usuariosManuales || destinatarios.usuariosManuales.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Debe seleccionar al menos un destinatario'
        });
      }

      let totalEnviados = 0;
      let totalErrores = 0;
      const erroresDetalle = [];

      for (const userId of destinatarios.usuariosManuales) {
        try {

          await addNotification(db, {
            userId: userId,
            titulo,
            descripcion,
            prioridad,
            color,
            icono,
            actionUrl
          });

          totalEnviados++;

          if (enviarCorreo === true) {
            const usuarioDestino = await db
              .collection("usuarios")
              .findOne({ _id: new ObjectId(userId) });

            if (usuarioDestino?.mail) {
              try {
                const emailDecrypted = decrypt(usuarioDestino.mail);

                if (emailDecrypted && emailDecrypted.includes('@')) {
                  await sendEmail({
                    to: emailDecrypted,
                    subject: titulo,
                    html:`
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; padding: 40px 10px; text-align: center;">
                        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center;">
                            
                            <h1 style="color: #1f2937; font-size: 22px; margin-bottom: 20px; font-weight: 700;">
                                Nueva Notificación
                            </h1>

                            <div style="color: #4b5563; font-size: 16px; line-height: 1.6; margin-bottom: 30px; text-align: left;">
                                ${descripcion}
                            </div>

                            <div style="text-align: center; margin-bottom: 20px;">
                                <a href="${urlNotificaciones}" 
                                  style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
                                    Ver notificación en la plataforma
                                </a>
                            </div>

                            <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; font-size: 12px; color: #9ca3af; text-align: center;">
                                <p style="margin: 0;">Este es un aviso automático de la plataforma.</p>
                                <p>© ${new Date().getFullYear()} Plataforma Acciona.</p>
                            </div>
                        </div>
                    </div>
                    `
                  }, req);
                }
              } catch (emailError) {
                console.error("Error enviando correo:", emailError.message);
              }
            }
          }

        } catch (error) {
          totalErrores++;
          erroresDetalle.push({
            userId,
            error: error.message
          });
          console.error(`Error al enviar a ${userId}:`, error);
        }
      }

      resultadoEnvio = {
        modifiedCount: totalEnviados,
        errores: totalErrores,
        erroresDetalle
      };

    }

    const respuesta = {
      success: true,
      message: `Notificación enviada exitosamente a ${resultadoEnvio?.modifiedCount || 0} usuario(s)`,
      data: {
        titulo,
        fechaEnvio,
        destinatariosEnviados: resultadoEnvio?.modifiedCount || 0,
        errores: resultadoEnvio?.errores || 0,
        enviadoPor: {
          userId: user._id.toString(),
          email: tokenData.email,
          rol: user.rol
        }
      }
    };

    res.json(respuesta);

  } catch (error) {
    console.error('ERROR CRÍTICO en POST /api/anuncios:', error);
    console.error('Stack trace:', error.stack);

    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      detalle: error.message
    });
  }
});

// Las rutas GET se mantienen IGUAL, SIN tokenizar
router.get('/', async (req, res) => {

  try {
    const respuesta = {
      success: true,
      data: []
    };

    res.json(respuesta);

  } catch (error) {
    console.error('ERROR en GET /api/anuncios:', error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Endpoint de anuncios funcionando',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;