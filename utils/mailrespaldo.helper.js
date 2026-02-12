// Importamos directamente la lógica de envío desde el helper
// Nota: La ruta supone que mail.helper.js está en la misma carpeta (utils/)
const { sendEmail } = require("./mail.helper");

/**
 * Genera el contenido del correo de respaldo usando la misma lógica que los TXT
 */
const generarContenidoCorreoRespaldo = (formTitle, usuario, fecha, responses, questions) => {

  /**
   * Función para procesar preguntas y respuestas en formato texto
   */
  const generarContenidoRespuestas = (responses, questions) => {
    let contenido = "RESPUESTAS DEL FORMULARIO\n";
    contenido += "========================\n\n";

    let index = 1;

    const procesarPreguntas = (preguntas, nivel = 0, contexto = '') => {
      let contenidoLocal = '';
      const indent = '  '.repeat(nivel);

      preguntas.forEach((pregunta, preguntaIndex) => {
        if (!pregunta || !pregunta.title) return;

        const tituloPregunta = pregunta.title;
        const respuesta = obtenerRespuestaPorTitulo(tituloPregunta, responses);

        const tieneRespuesta = respuesta !== undefined && respuesta !== null &&
          respuesta !== '' && !(Array.isArray(respuesta) && respuesta.length === 0);

        if (tieneRespuesta || pregunta.required) {
          const numeroPregunta = nivel === 0 ? `${index}.` : `  ${preguntaIndex + 1}.`;
          const tituloCompleto = contexto ? `${contexto} - ${tituloPregunta}` : tituloPregunta;

          contenidoLocal += `${indent}${numeroPregunta} ${tituloCompleto}\n`;

          if (Array.isArray(respuesta)) {
            contenidoLocal += `${indent}   - ${respuesta.join(`\n${indent}   - `)}\n\n`;
          } else if (respuesta && typeof respuesta === 'object') {
            contenidoLocal += `${indent}   ${JSON.stringify(respuesta, null, 2)}\n\n`;
          } else {
            contenidoLocal += `${indent}   ${respuesta || 'Sin respuesta'}\n\n`;
          }

          if (nivel === 0) index++;
        }

        if (pregunta.options) {
          pregunta.options.forEach((opcion, opcionIndex) => {
            if (typeof opcion === 'object' && opcion.hasSubform && opcion.subformQuestions) {
              const textoOpcion = opcion.text || `Opción ${opcionIndex + 1}`;
              const opcionRespuesta = obtenerRespuestaPorTitulo(pregunta.title, responses);
              const deberiaProcesar =
                pregunta.type === 'single_choice' ? opcionRespuesta === textoOpcion :
                  pregunta.type === 'multiple_choice' ? Array.isArray(opcionRespuesta) && opcionRespuesta.includes(textoOpcion) : false;

              if (deberiaProcesar) {
                contenidoLocal += procesarPreguntas(
                  opcion.subformQuestions,
                  nivel + 1,
                  `${tituloPregunta} - ${textoOpcion}`
                );
              }
            }
          });
        }
      });

      return contenidoLocal;
    };

    contenido += procesarPreguntas(questions || []);

    if (responses._contexto && Object.keys(responses._contexto).length > 0) {
      contenido += "\n--- INFORMACIÓN DETALLADA POR SECCIÓN ---\n\n";

      Object.keys(responses._contexto).forEach(contexto => {
        contenido += `SECCIÓN: ${contexto}\n`;
        Object.keys(responses._contexto[contexto]).forEach(pregunta => {
          const respuesta = responses._contexto[contexto][pregunta];
          contenido += `   ${pregunta}: ${respuesta}\n`;
        });
        contenido += "\n";
      });
    }

    return contenido;
  };

  const obtenerRespuestaPorTitulo = (tituloPregunta, responses) => {
    if (responses[tituloPregunta] !== undefined) {
      return responses[tituloPregunta];
    }
    if (responses._contexto) {
      for (const contexto in responses._contexto) {
        if (responses._contexto[contexto][tituloPregunta] !== undefined) {
          return responses._contexto[contexto][tituloPregunta];
        }
      }
    }
    return undefined;
  };

  const nombreTrabajador = responses['Nombre del trabajador'] || usuario.nombre;
  const contenidoRespuestas = generarContenidoRespuestas(responses, questions);

  const texto = `RESPALDO DE RESPUESTAS - FORMULARIO: ${formTitle}
=================================================

INFORMACIÓN GENERAL:
-------------------
Trabajador: ${nombreTrabajador}
Empresa: ${usuario.empresa}
Respondido por: ${usuario.nombre}
Fecha y hora: ${fecha}

${contenidoRespuestas}
---
Este es un respaldo automático de las respuestas enviadas.
Generado el: ${fecha}
`;

  const html = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
    RESPALDO DE RESPUESTAS - FORMULARIO: ${formTitle}
  </h2>
  
  <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #3498db;">
    <h3 style="color: #2c3e50; margin-top: 0;">INFORMACIÓN GENERAL</h3>
    <p><strong>Trabajador:</strong> ${nombreTrabajador}</p>
    <p><strong>Empresa:</strong> ${usuario.empresa}</p>
    <p><strong>Respondido por:</strong> ${usuario.nombre}</p>
    <p><strong>Fecha y hora:</strong> ${fecha}</p>
  </div>

  <div style="background: white; padding: 20px; border-radius: 5px; border: 1px solid #ddd;">
    <h3 style="color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px;">RESPUESTAS DEL FORMULARIO</h3>
    <div style="white-space: pre-line; font-family: monospace; font-size: 14px; line-height: 1.4;">
${contenidoRespuestas.replace(/\n/g, '<br>').replace(/  /g, '&nbsp;&nbsp;')}
    </div>
  </div>

  <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #ccc; color: #7f8c8d; font-size: 12px;">
    <em>Este es un respaldo automático de las respuestas enviadas.<br>
    Generado el: ${fecha}</em>
  </div>
</div>
`;

  return { texto, html };
};

/**
 * Envía el correo de respaldo importando el componente de mail directamente
 */
const enviarCorreoRespaldo = async (correoRespaldo, formTitle, usuario, responses, questions, req) => {
  try {
    if (!correoRespaldo || correoRespaldo.trim() === '') {
      return { enviado: false, motivo: 'No hay correo de respaldo' };
    }

    const fechaHora = new Date().toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      dateStyle: 'full',
      timeStyle: 'medium'
    });

    const contenido = generarContenidoCorreoRespaldo(
      formTitle,
      usuario,
      fechaHora,
      responses,
      questions
    );

    // Definimos el objeto para la función interna (sin necesidad de accessKey)
    const emailData = {
      to: correoRespaldo.trim(),
      subject: `Respaldo de respuestas - ${formTitle}`,
      text: contenido.texto,
      html: contenido.html
    };

    // Llamamos directamente a la función del componente mail
    const result = await sendEmail(emailData, req);

    return { enviado: true, result };

  } catch (error) {
    console.error('Error enviando correo de respaldo (interno):', error);
    return { enviado: false, motivo: error.message };
  }
};

module.exports = {
  generarContenidoCorreoRespaldo,
  enviarCorreoRespaldo
};