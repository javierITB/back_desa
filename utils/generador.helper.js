const express = require("express");
const fs = require("fs");
const path = require("path");
const docx = require("docx");
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, BorderStyle, HeadingLevel } = docx;
const { createBlindIndex, decrypt } = require("./seguridad.helper");

// ========== UTILS: NORMALIZACIÓN Y FECHAS ==========

function esCampoDeFecha(nombreVariable) {
    const patronesFecha = [
        'FECHA', 'FECHAS', 'FECHA_', '_FECHA', 'FECHA_DE_', '_FECHA_',
        'INICIO', 'TERMINO', 'FIN', 'VIGENCIA', 'VIGENTE', 'CONTRATO',
        'MODIFICACION', 'ACTUALIZACION', 'RENOVACION', 'COMPROMISO'
    ];
    const nombreUpper = nombreVariable.toUpperCase();
    return patronesFecha.some(patron => nombreUpper.includes(patron));
}

function formatearFechaEspanol(fechaIso) {
    const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    let d;
    if (fechaIso.includes('T')) {
        d = new Date(fechaIso);
    } else {
        const [year, month, day] = fechaIso.split('-');
        d = new Date(year, month - 1, day);
    }
    if (isNaN(d.getTime())) return fechaIso;
    return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function generarIdDoc() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `doc_${timestamp}${random}`.toUpperCase();
}

function normalizarNombreVariable(title) {
    if (!title) return '';
    let tag = title.toUpperCase();
    tag = tag.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    tag = tag.replace(/[^A-Z0-9]+/g, '_');
    tag = tag.replace(/^_+|_+$/g, '').replace(/__+/g, '_');
    return tag;
}

const ORDINALES = [
    "", "PRIMERO", "SEGUNDO", "TERCERO", "CUARTO", "QUINTO",
    "SEXTO", "SÉPTIMO", "OCTAVO", "NOVENO", "DÉCIMO",
    "UNDÉCIMO", "DUODÉCIMO", "DÉCIMO TERCERO", "DÉCIMO CUARTO",
    "DÉCIMO QUINTO", "DÉCIMO SEXTO", "DÉCIMO SÉPTIMO",
    "DÉCIMO OCTAVO", "DÉCIMO NOVENO", "VIGÉSIMO"
];

// ========== UTILS: SEGURIDAD / BD ==========

async function obtenerEmpresaDesdeBD(nombreEmpresa, db) {
    try {
        if (!db || typeof db.collection !== 'function') throw new Error("Base de datos no disponible");
        const nombreIndex = createBlindIndex(nombreEmpresa);
        const empresa = await db.collection('empresas').findOne({ nombre_index: nombreIndex });
        if (empresa) {
            return {
                nombre: decrypt(empresa.nombre),
                rut: decrypt(empresa.rut),
                encargado: decrypt(empresa.encargado),
                direccion: decrypt(empresa.direccion),
                rut_encargado: decrypt(empresa.rut_encargado),
                logo: empresa.logo // Mantener logo tal cual
            };
        }
        return null;
    } catch (error) {
        console.error('Error buscando empresa en BD:', error);
        return null;
    }
}

function crearLogoImagen(logoData) {
    if (!logoData || !logoData.fileData) return null;
    try {
        let imageBuffer;
        if (typeof logoData.fileData === 'string' && logoData.fileData.includes(':')) {
            const base64Descifrado = decrypt(logoData.fileData);
            imageBuffer = Buffer.from(base64Descifrado, 'base64');
        } else if (logoData.fileData && logoData.fileData.buffer) {
            imageBuffer = Buffer.from(logoData.fileData.buffer);
        } else if (Buffer.isBuffer(logoData.fileData)) {
            imageBuffer = logoData.fileData;
        } else if (typeof logoData.fileData === 'string') {
            imageBuffer = Buffer.from(logoData.fileData, 'base64');
        } else {
            return null;
        }

        if (!imageBuffer || imageBuffer.length === 0) return null;

        return new ImageRun({
            data: imageBuffer,
            transformation: { width: 100, height: 100 },
            floating: { horizontalPosition: { offset: 201440 }, verticalPosition: { offset: 201440 } }
        });
    } catch (error) {
        console.error('Error creando imagen del logo:', error);
        return null;
    }
}

async function buscarPlantillaPorFormId(formId, db) {
    try {
        if (!db || typeof db.collection !== 'function') throw new Error("Base de datos no disponible");
        let query = { status: "publicado" };
        const possibleIds = [formId];
        try {
            if (typeof formId === 'string' && formId.length === 24) {
                const { ObjectId } = require('mongodb');
                possibleIds.push(new ObjectId(formId));
            }
        } catch (e) { }
        query.formId = { $in: possibleIds };
        return await db.collection('plantillas').findOne(query);
    } catch (error) {
        console.error('Error buscando plantilla:', error);
        return null;
    }
}

async function extraerVariablesDeRespuestas(responses, userData, db) {
    const variables = {};
    Object.keys(responses).forEach(key => {
        if (key === '_contexto') return;
        let valor = responses[key];
        if (Array.isArray(valor)) valor = valor.join(', ');
        if (valor && typeof valor === 'object' && !Array.isArray(valor)) valor = JSON.stringify(valor);
        const nombreVariable = normalizarNombreVariable(key);
        variables[nombreVariable] = valor || '';
    });

    if (userData && userData.empresa) {
        try {
            let nombreEmpresaDescifrado = userData.empresa.includes(':') ? decrypt(userData.empresa) : userData.empresa;
            const empresaInfo = await obtenerEmpresaDesdeBD(nombreEmpresaDescifrado, db);
            if (empresaInfo) {
                if (!variables[normalizarNombreVariable('Empresa')]) variables[normalizarNombreVariable('Empresa')] = empresaInfo.nombre;
                if (!variables[normalizarNombreVariable('Nombre empresa')]) variables[normalizarNombreVariable('Nombre empresa')] = empresaInfo.nombre;
                variables[normalizarNombreVariable('Rut empresa')] = empresaInfo.rut || '';
                variables[normalizarNombreVariable('Encargado empresa')] = empresaInfo.encargado || '';
                variables[normalizarNombreVariable('Rut encargado empresa')] = empresaInfo.rut_encargado || '';
                variables[normalizarNombreVariable('Direccion empresa')] = empresaInfo.direccion || '';
            } else {
                variables[normalizarNombreVariable('Empresa')] = nombreEmpresaDescifrado;
                variables[normalizarNombreVariable('Nombre empresa')] = nombreEmpresaDescifrado;
            }
        } catch (error) {
            console.error("Error obteniendo información de empresa:", error);
        }
    }

    const hoy = new Date();
    variables['FECHA_ACTUAL'] = formatearFechaEspanol(hoy.toISOString().split("T")[0]);
    variables['HORA_ACTUAL'] = hoy.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });
    const unAnio = new Date(hoy); unAnio.setFullYear(hoy.getFullYear() + 1);
    variables['FECHA_ACTUAL_1_ANIO'] = formatearFechaEspanol(unAnio.toISOString().split("T")[0]);
    const seisMeses = new Date(hoy); seisMeses.setMonth(hoy.getMonth() + 6);
    variables['FECHA_ACTUAL_6_MESES'] = formatearFechaEspanol(seisMeses.toISOString().split("T")[0]);
    const unMes = new Date(hoy); unMes.setMonth(hoy.getMonth() + 1);
    variables['FECHA_ACTUAL_1_MES'] = formatearFechaEspanol(unMes.toISOString().split("T")[0]);

    // Variables numéricas por defecto vacías si no existen
    // Agrear lógica extra si es necesario
    return variables;
}

// ========== LOGICA CONDICIONAL Y VARIABLES ==========

function evaluarCondicional(conditionalVar, variables) {
    if (!conditionalVar || conditionalVar.trim() === '') return true;

    // Quitar [[IF: y ]] si vienen (aunque el split debería manejarlo antes)
    let condicion = conditionalVar.replace(/^(\[\[IF:|{{)(.*?)(]])?$/i, '$2').trim();

    // 1. OR ||
    if (condicion.includes('||')) {
        const parts = condicion.split('||').map(p => p.trim());
        for (const part of parts) {
            if (evaluarCondicional(part, variables)) return true;
        }
        return false;
    }

    // 2. AND && (Opcional, pero buena práctica)
    if (condicion.includes('&&')) {
        const parts = condicion.split('&&').map(p => p.trim());
        for (const part of parts) {
            if (!evaluarCondicional(part, variables)) return false;
        }
        return true;
    }

    let varName, valueToCheck, operator;

    if (condicion.includes(' < ')) {
        [varName, valueToCheck] = condicion.split(' < ');
        operator = '<';
    } else if (condicion.includes(' > ')) {
        [varName, valueToCheck] = condicion.split(' > ');
        operator = '>';
    } else if (condicion.includes(' = ') || condicion.includes('==')) {
        [varName, valueToCheck] = condicion.split(/==| = /);
        operator = '=';
    } else if (condicion.includes('!=')) {
        [varName, valueToCheck] = condicion.split('!=');
        operator = '!=';
    } else {
        // Chequeo de existencia simple
        varName = condicion;
    }

    // Limpieza de varName: quitar {{, }}, y posibles : al final (como en el ejemplo del usuario {{VAR:}})
    varName = varName.replace(/[{}]/g, '').replace(/:$/, '').trim();
    if (valueToCheck) valueToCheck = valueToCheck.replace(/["']/g, '').trim();

    const valorVariable = variables[varName];
    const valorStr = valorVariable ? String(valorVariable).trim() : '';

    if (!operator) {
        return valorStr !== '' && valorStr !== 'false' && valorStr !== '0';
    }

    if (operator === '<') return valorStr.toLowerCase() < valueToCheck.toLowerCase();
    if (operator === '>') return valorStr.toLowerCase() > valueToCheck.toLowerCase();
    if (operator === '=') return valorStr.toLowerCase() === valueToCheck.toLowerCase();
    if (operator === '!=') return valorStr.toLowerCase() !== valueToCheck.toLowerCase();

    return false;
}

function reemplazarVariablesEnTexto(texto, variables, estiloBase, contadorNumeral) {
    const runs = [];
    const regexVar = /{{([^}]+)}}/g;
    let match;
    let lastIndex = 0;

    while ((match = regexVar.exec(texto)) !== null) {
        const fullVar = match[0];
        // Quitar posibles dos puntos al final (ej: {{VAR:}})
        const rawVarName = match[1].trim().replace(/:$/, '');
        const idx = match.index;

        // Texto previo
        if (idx > lastIndex) {
            runs.push(new TextRun({
                text: texto.substring(lastIndex, idx),
                bold: estiloBase.bold,
                italics: estiloBase.italics,
                underline: estiloBase.underline ? { type: BorderStyle.SINGLE } : undefined,
                font: estiloBase.font,
                size: estiloBase.size
            }));
        }

        // Procesar variable especial NUMERAL
        if (rawVarName === 'NUMERAL') {
            if (contadorNumeral) {
                const numeralTexto = ORDINALES[contadorNumeral.valor] || `${contadorNumeral.valor}°`;
                contadorNumeral.valor++;
                runs.push(new TextRun({
                    text: numeralTexto,
                    bold: true, // Numerales usualmente en negrita
                    italics: estiloBase.italics,
                    underline: estiloBase.underline ? { type: BorderStyle.SINGLE } : undefined,
                    font: estiloBase.font,
                    size: estiloBase.size
                }));
            } else {
                runs.push(new TextRun({ text: "[NUMERAL]", bold: true }));
            }
        }
        else {
            // Variable normal
            const varName = normalizarNombreVariable(rawVarName);
            // Intentar buscar también con el nombre raw si falla la normalización estricta
            let valor = variables[varName] !== undefined ? variables[varName] : variables[rawVarName];

            // Si no existe, mostrar raw. Si existe pero vacío, mostrar vacío.
            if (valor === undefined) valor = `[${rawVarName}]`;

            // Formato Fecha
            if (esCampoDeFecha(rawVarName) && valor && !valor.includes('[')) {
                try { valor = formatearFechaEspanol(valor); } catch (e) { }
            }

            runs.push(new TextRun({
                text: String(valor),
                bold: true, // Variables típicamente se destacan en negrita, pero podría ser configurable
                italics: estiloBase.italics,
                underline: estiloBase.underline ? { type: BorderStyle.SINGLE } : undefined,
                font: estiloBase.font,
                size: estiloBase.size
            }));
        }

        lastIndex = idx + fullVar.length;
    }

    // Texto final
    if (lastIndex < texto.length) {
        runs.push(new TextRun({
            text: texto.substring(lastIndex),
            bold: estiloBase.bold,
            italics: estiloBase.italics,
            underline: estiloBase.underline ? { type: BorderStyle.SINGLE } : undefined,
            font: estiloBase.font,
            size: estiloBase.size
        }));
    }

    return runs;
}

// ========== PARSER HTML (TIPTAP) MEJORADO ==========

function parsearEstilosInline(elementStr) {
    const style = {
        bold: elementStr.includes('<strong>') || elementStr.includes('<b>'),
        italics: elementStr.includes('<em>') || elementStr.includes('<i>'),
        underline: elementStr.includes('<u>'),
        textAlign: AlignmentType.JUSTIFIED, // Default
        font: 'Arial',
        size: 24 // 12pt approx
    };

    if (elementStr.includes('text-align: center')) style.textAlign = AlignmentType.CENTER;
    if (elementStr.includes('text-align: right')) style.textAlign = AlignmentType.RIGHT;
    if (elementStr.includes('text-align: left')) style.textAlign = AlignmentType.LEFT;

    return style;
}

function procesarHTML(html, variables) {
    if (!html) return [];

    // Limpiar entes HTML básicos
    let cleanHtml = html
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<br\s*\/?>/gi, '\n');

    // Estado global de procesamiento
    const contadorNumeral = { valor: 1 };
    const children = [];

    const regexBloques = /<(p|table)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    // Stack de condicionales
    const condicionalStack = []; // true = mostrar, false = ocultar

    // Helper para verificar si debemos mostrar contenido actual
    const debeMostrar = () => condicionalStack.every(v => v === true);

    // Si no hay etiquetas P ni Table, envolvemos todo en un P
    if (!cleanHtml.match(/<(p|table)/i)) {
        cleanHtml = `<p>${cleanHtml}</p>`;
    }

    // Helper para parsear estilos inline de etiquetas HTML
    function parsearEstilosInline(htmlTag) {
        // Normalizamos comillas y espacios para facilitar regex
        const tagNormalized = htmlTag.replace(/'/g, '"').replace(/\s+/g, ' ');

        const styleMatch = tagNormalized.match(/style="([^"]*)"/i);
        const classMatch = tagNormalized.match(/class="([^"]*)"/i);

        const styles = { textAlign: AlignmentType.JUSTIFIED }; // Default

        // Check Inline Styles
        if (styleMatch && styleMatch[1]) {
            const styleStr = styleMatch[1].toLowerCase();
            if (styleStr.includes('text-align:center') || styleStr.includes('text-align: center')) styles.textAlign = AlignmentType.CENTER;
            else if (styleStr.includes('text-align:right') || styleStr.includes('text-align: right')) styles.textAlign = AlignmentType.RIGHT;
            else if (styleStr.includes('text-align:left') || styleStr.includes('text-align: left')) styles.textAlign = AlignmentType.LEFT;
            else if (styleStr.includes('text-align:justify') || styleStr.includes('text-align: justify')) styles.textAlign = AlignmentType.JUSTIFIED;
        }

        // Check Classes
        if (classMatch && classMatch[1]) {
            const classStr = classMatch[1].toLowerCase();
            if (classStr.includes('center')) styles.textAlign = AlignmentType.CENTER;
            else if (classStr.includes('right')) styles.textAlign = AlignmentType.RIGHT;
            else if (classStr.includes('left')) styles.textAlign = AlignmentType.LEFT;
            else if (classStr.includes('justify')) styles.textAlign = AlignmentType.JUSTIFIED;
        }

        return styles;
    }

    // Iteramos sobre los bloques encontrados
    while ((match = regexBloques.exec(cleanHtml)) !== null) {
        const fullTag = match[0];
        const tagName = match[1].toLowerCase();
        const innerContent = match[2];

        // Mejor limpieza para detectar lógica: decoded entities, sin tags, trim
        let textoPlano = innerContent.replace(/<[^>]*>/g, '');
        textoPlano = textoPlano.replace(/&nbsp;/g, ' ').trim();

        // Regex má flexible: permite espacios, chars invisibles
        const matchIf = textoPlano.match(/^\[\[\s*IF:(.*?)\s*\]\]$/i);
        const matchEndIf = textoPlano.match(/^\[\[\s*ENDIF\s*\]\]$/i);

        if (matchIf) {
            const condicion = matchIf[1];
            const resultado = evaluarCondicional(condicion, variables);
            condicionalStack.push(resultado);
            continue; // No renderizar la línea del IF
        }

        if (matchEndIf) {
            condicionalStack.pop();
            continue; // No renderizar la línea del ENDIF
        }

        if (!debeMostrar()) continue;

        // --- PROCESAMIENTO DE BLOQUE VISIBLE ---
        if (tagName === 'p') {
            const style = parsearEstilosInline(fullTag);

            const parts = innerContent.split(/(<\/?(?:strong|b|em|i|u)>)/gi);
            const paragraphChildren = [];

            let currentSpanStyle = { ...style }; // Copia base

            for (const part of parts) {
                if (!part) continue;
                const lower = part.toLowerCase();

                // Toggle estilos
                if (lower === '<strong>' || lower === '<b>') { currentSpanStyle.bold = true; continue; }
                if (lower === '</strong>' || lower === '</b>') { currentSpanStyle.bold = false; continue; }
                if (lower === '<em>' || lower === '<i>') { currentSpanStyle.italics = true; continue; }
                if (lower === '</em>' || lower === '</i>') { currentSpanStyle.italics = false; continue; }
                if (lower === '<u>') { currentSpanStyle.underline = true; continue; }
                if (lower === '</u>') { currentSpanStyle.underline = false; continue; }

                // Texto
                const runs = reemplazarVariablesEnTexto(part, variables, currentSpanStyle, contadorNumeral);
                paragraphChildren.push(...runs);
            }

            // Detección heurística de títulos o numerales para evitar que queden huérfanos
            // Si el texto es corto, en mayúsculas, o contiene palabras clave de numeral, aplicamos keepNext
            const textContent = innerContent.replace(/<[^>]*>/g, '').trim();
            const isObercase = textContent === textContent.toUpperCase() && textContent.length > 0;
            const isShort = textContent.length < 100; // Arbitrario para títulos
            const isNumeral = /^(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|SÉPTIMO|OCTAVO|NOVENO|DÉCIMO|UNDÉCIMO|DUODÉCIMO|DECIMOTERCERO)/i.test(textContent);

            const shouldKeepNext = (isObercase && isShort) || isNumeral;

            children.push(new Paragraph({
                alignment: style.textAlign,
                children: paragraphChildren,
                spacing: { after: 120 },
                keepNext: shouldKeepNext, // Mantiene pegado al siguiente párrafo
                keepLines: shouldKeepNext // Evita que se parta el propio título
            }));
        }
        else if (tagName === 'table') {
            // Parsear Tabla Simple
            // Asumimos estructura <table><tbody><tr><td>...
            const rows = [];
            const regexTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let matchTr;

            while ((matchTr = regexTr.exec(innerContent)) !== null) {
                const trContent = matchTr[1];
                const cells = [];
                const regexTd = /<td[^>]*>([\s\S]*?)<\/td>/gi;
                let matchTd;

                while ((matchTd = regexTd.exec(trContent)) !== null) {
                    const tdContent = matchTd[1];
                    // Recursivamente procesar contenido dentro de TD como si fuera HTML plano (aunque docx espera Paragraphs dentro de celdas)
                    // Simplificación: Extraemos texto y creamos un párrafo por ahora
                    // Idealmente llamaríamos a procesarHTML recursivo pero evitar ciclos infinitos

                    const tdText = tdContent.replace(/<[^>]*>/g, ''); // Simplificado
                    const tdRuns = reemplazarVariablesEnTexto(tdText, variables, { size: 24 }, contadorNumeral);

                    cells.push(new TableCell({
                        children: [new Paragraph({ children: tdRuns })],
                        width: { size: 100, type: WidthType.PERCENTAGE } // Distribución auto
                    }));
                }
                rows.push(new TableRow({ children: cells }));
            }

            children.push(new Table({
                rows: rows,
                width: { size: 100, type: WidthType.PERCENTAGE }
            }));
        }
    }

    return children;
}

// ========== GENERADOR MAIN Y LEGACY SUPPORT ==========

function reemplazarVariablesEnContenido(contenido, variables) {
    // FUNCIÓN LEGACY - Mantenida para compatibilidad con lógica antigua si es llamada externamente
    // Simplificada para usar la nueva lógica interna de Texto
    return reemplazarVariablesEnTexto(contenido, variables, { size: 24 }, null);
}

async function generarDocumentoDesdePlantilla(responses, responseId, db, plantilla, userData, formTitle) {
    try {
        console.log("=== GENERANDO DOCUMENTO (TIPTAP SYSTEM) ===");
        const variables = await extraerVariablesDeRespuestas(responses, userData, db);
        const empresaInfo = await obtenerEmpresaDesdeBD(userData?.empresa || '', db);
        const logo = empresaInfo ? empresaInfo.logo : null;

        const children = [];

        // 1. LOGO
        if (logo) {
            const logoImagen = crearLogoImagen(logo);
            if (logoImagen) {
                children.push(new Paragraph({ children: [logoImagen] }));
                children.push(new Paragraph({ text: "" }));
            }
        }

        // 2. CONTENIDO PRINCIPAL
        if (plantilla.documentContent) {
            // NUEVO: Usar parser HTML con alineación correcta
            const bloquesHTML = procesarHTML(plantilla.documentContent, variables);
            children.push(...bloquesHTML);
        } else if (plantilla.paragraphs) {
            // LEGACY: Usar array paragraphs antiguo
            console.log("Usando sistema Legacy (paragraphs array)");
            const contadorNumeralLegacy = { valor: 1 };

            for (const parrafo of plantilla.paragraphs) {
                if (evaluarCondicional(parrafo.conditionalVar, variables)) {
                    const runs = reemplazarVariablesEnTexto(parrafo.content, variables, { size: 24 }, contadorNumeralLegacy);
                    children.push(new Paragraph({
                        alignment: AlignmentType.JUSTIFIED,
                        children: runs,
                        spacing: { after: 120 }
                    }));
                }
            }
        }

        // 3. FIRMAS (TABLA 2 COLUMNAS)
        if (plantilla.signature1Text || plantilla.signature2Text) {
            children.push(new Paragraph({ text: "", spacing: { before: 800 } })); // Espacio antes de firma

            // Helper para procesar firma: retorna array de Paragraphs para mejor control
            const procesarFirma = (textoFirma) => {
                const parrafosFirma = [];
                if (!textoFirma) return parrafosFirma;

                const lineas = textoFirma.split(/\r?\n/);

                for (let i = 0; i < lineas.length; i++) {
                    const linea = lineas[i];

                    // FILTRO DE TEXTO NO DESEADO (Para evitar duplicados si el usuario lo escribió)
                    if (linea.toLowerCase().includes('firma del empleador') ||
                        linea.toLowerCase().includes('firma del empleado') ||
                        linea.toLowerCase().includes('representante legal') ||
                        linea.toLowerCase().includes('______')) {
                        continue;
                    }

                    if (linea.trim() === '') {
                        parrafosFirma.push(new Paragraph({ text: "", spacing: { after: 200 } }));
                        continue;
                    }

                    const runsLinea = reemplazarVariablesEnTexto(linea, variables, { size: 24, bold: false }, null);

                    parrafosFirma.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: runsLinea,
                        spacing: { after: 0 }
                    }));
                }
                return parrafosFirma;
            };

            // Generar contenido dinámico
            const dynamicContent1 = procesarFirma(plantilla.signature1Text);
            const dynamicContent2 = procesarFirma(plantilla.signature2Text);

            // Construir Bloques Completos (Línea + Título + Dinámico)
            const generarBloqueFirma = (titulo, contenidoDinamico) => {
                return [
                    // 1. Línea de firma (Guiones bajos)
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: "__________________________", bold: true, size: 24 })],
                        spacing: { after: 120 } // Espacio entre línea y título
                    }),
                    // 2. Título (Empleador/Empleado) - MANTENEMOS NEGRITA SOLO EN TÍTULO
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: titulo, bold: true, size: 24 })],
                        spacing: { after: 0 }
                    }),
                    // 3. Contenido Dinámico (Variables)
                    ...contenidoDinamico
                ];
            };

            const cell1Children = generarBloqueFirma("Empleador / Representante Legal", dynamicContent1);
            const cell2Children = generarBloqueFirma("Empleado", dynamicContent2);

            const borderNone = {
                style: BorderStyle.NIL,
                size: 0,
                color: "auto"
            };

            const bordersNoneConfig = {
                top: borderNone,
                bottom: borderNone,
                left: borderNone,
                right: borderNone,
                insideHorizontal: borderNone,
                insideVertical: borderNone
            };

            children.push(new Table({
                width: { size: 8500, type: WidthType.DXA }, // Ancho más seguro (aprox 15cm) para Carta con márgenes
                alignment: AlignmentType.CENTER, // Centrar tabla
                layout: TableLayoutType.FIXED, // IMPORTANTE: Fija el ancho de columnas estrictamente
                borders: bordersNoneConfig,
                rows: [
                    new TableRow({
                        cantSplit: true,
                        children: [
                            new TableCell({
                                width: { size: 4250, type: WidthType.DXA }, // 50% exacto (4250 DXA)
                                borders: bordersNoneConfig,
                                children: cell1Children
                            }),
                            new TableCell({
                                width: { size: 4250, type: WidthType.DXA }, // 50% exacto (4250 DXA)
                                borders: bordersNoneConfig,
                                children: cell2Children
                            })
                        ]
                    })
                ]
            }));
        }

        const doc = new Document({
            sections: [{
                properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
                children: children
            }]
        });

        const buffer = await Packer.toBuffer(doc);
        const fileName = `${normalizarNombreVariable(formTitle)}.docx`;

        const existing = await db.collection('docxs').findOne({ responseId });
        const idDoc = existing ? existing.IDdoc : generarIdDoc();

        await db.collection('docxs').updateOne(
            { responseId },
            { $set: { docxFile: buffer, fileName, tipo: 'docx', IDdoc: idDoc, updatedAt: new Date() } },
            { upsert: true }
        );

        return { IDdoc: idDoc, buffer, tipo: 'docx' };
    } catch (error) {
        console.error('Error generando DOCX (Tiptap):', error);
        throw error;
    }
}

// ========== TXT FALLBACK ==========

async function generarDocumentoTxt(responses, responseId, db, formTitle) {
    try {
        console.log("Generando TXT fallback...");
        let content = `FORMULARIO: ${formTitle || 'SIN TITULO'}\n\n`;
        Object.entries(responses).forEach(([k, v]) => {
            if (k !== '_contexto') content += `${k}: ${v}\n`;
        });
        const buffer = Buffer.from(content, 'utf8');
        const fileName = "RESPUESTA_TXT";

        const existing = await db.collection('docxs').findOne({ responseId });
        const idDoc = existing ? existing.IDdoc : generarIdDoc();

        await db.collection('docxs').updateOne(
            { responseId },
            { $set: { docxFile: buffer, fileName, tipo: 'txt', IDdoc: idDoc, updatedAt: new Date() } },
            { upsert: true }
        );
        return { IDdoc: idDoc, buffer, tipo: 'txt' };
    } catch (e) {
        console.error("Error TXT:", e); throw e;
    }
}

async function generarAnexoDesdeRespuesta(responses, responseId, db, section, userData, formId, formTitle) {
    console.log(`[GENERADOR] Iniciando para formId: ${formId}, responseId: ${responseId}`);

    if (!formId) {
        console.log("[GENERADOR] No hay formId, generando TXT");
        return await generarDocumentoTxt(responses, responseId, db, formTitle);
    }

    const plantilla = await buscarPlantillaPorFormId(formId, db);

    if (plantilla) {
        console.log(`[GENERADOR] Plantilla encontrada: ${plantilla._id} (Título: ${plantilla.documentTitle})`);
        try {
            return await generarDocumentoDesdePlantilla(responses, responseId, db, plantilla, userData, formTitle);
        } catch (error) {
            console.error("[GENERADOR] Error crítico generando DOCX desde plantilla:", error);
            // Fallback a TXT si falla la generación DOCX
            return await generarDocumentoTxt(responses, responseId, db, formTitle);
        }
    } else {
        console.log(`[GENERADOR] No se encontró plantilla para formId: ${formId}`);
    }

    return await generarDocumentoTxt(responses, responseId, db, formTitle);
}

async function buscarPlantillaPorFormId(formId, db) {
    try {
        if (!db || typeof db.collection !== 'function') throw new Error("Base de datos no disponible");
        let query = { status: "publicado" };
        const possibleIds = [formId];
        try {
            if (typeof formId === 'string' && formId.length === 24) {
                const { ObjectId } = require('mongodb');
                possibleIds.push(new ObjectId(formId));
            }
        } catch (e) { }
        query.formId = { $in: possibleIds };

        console.log(`[GENERADOR] Buscando plantilla con query:`, JSON.stringify(query));
        const resultado = await db.collection('plantillas').findOne(query);
        console.log(`[GENERADOR] Resultado búsqueda:`, resultado ? 'ENCONTRADO' : 'NULL');
        return resultado;
    } catch (error) {
        console.error('Error buscando plantilla:', error);
        return null;
    }
}

module.exports = {
    generarAnexoDesdeRespuesta,
    generarDocumentoTxt,
    buscarPlantillaPorFormId,
    evaluarCondicional,
    reemplazarVariablesEnContenido
};