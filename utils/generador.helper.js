const express = require("express");
const fs = require("fs");
const path = require("path");
const docx = require("docx");
const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, BorderStyle, HeadingLevel, TableLayoutType, Header } = docx;
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

// ========== LOGO HELPERS ==========

// Helper para obtener tipo imagen DOCX
const mapMimeToDocxType = (mime) => {
    const m = mime ? mime.toLowerCase() : '';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpeg';
    if (m.includes('png')) return 'png';
    if (m.includes('gif')) return 'gif';
    return 'png';
};

// Validar Magic Bytes
function validarImagen(buffer, type) {
    if (!buffer || buffer.length < 4) return false;
    const header = buffer.toString('hex', 0, 4).toUpperCase();

    // PNG: 89 50 4E 47
    if (type === 'png' && header === '89504E47') return true;

    // JPEG: FF D8 ...
    if (type === 'jpeg' || type === 'jpg') {
        if (header.startsWith('FFD8')) return true;
    }

    // GIF: 47 49 46 38
    if (type === 'gif' && header === '47494638') return true;

    console.warn(`[IMAGE WARNING] Mismatch type ${type} vs header ${header}`);
    return false;
}

function procesarLogoEmpresa(empresaInfo) {
    if (!empresaInfo || !empresaInfo.logo || !empresaInfo.logo.fileData) return null;
    try {
        const logoDecrypted = decrypt(empresaInfo.logo.fileData);
        const buffer = Buffer.from(logoDecrypted, 'base64');
        const type = mapMimeToDocxType(empresaInfo.logo.mimeType);

        if (!validarImagen(buffer, type)) {
            console.error("Logo Empresa: Firma de archivo inválida.");
            return null; // Empresa logo might be old/bad, safer to skip than crash
        }
        return { buffer, type };
    } catch (e) {
        console.error("Error procesando logo empresa:", e);
        return null;
    }
}

function procesarLogoCustom(dataUrl) {
    if (!dataUrl) return null;
    try {
        const parts = dataUrl.split(',');
        let buffer, type;

        if (parts.length > 1) {
            const mimeMatch = parts[0].match(/:(.*?);/);
            type = mimeMatch ? mapMimeToDocxType(mimeMatch[1]) : 'png';
            buffer = Buffer.from(parts[1], 'base64');
        } else {
            type = 'png';
            buffer = Buffer.from(parts[0], 'base64');
        }

        if (!validarImagen(buffer, type)) {
            // THROW to trigger TXT fallback as requested by user for failing custom logos
            throw new Error(`Logo Custom: Firma de archivo inválida (${type} detectado, pero cabecera incorrecta).`);
        }

        return { buffer, type };
    } catch (e) {
        console.error("Error procesando logo custom:", e);
        throw e; // Relanzar
    }
}

// Crea el ImageRun para el Header
function crearImageRunHeader(imgData) {
    if (!imgData || !imgData.buffer) return null;
    return new ImageRun({
        data: imgData.buffer,
        transformation: { width: 100, height: 50 },
        type: imgData.type
    });
}

// Construye el objeto Header completo
function construirHeaderLogos(logoConfig, empresaInfo) {
    if (!logoConfig || (!logoConfig.left && !logoConfig.right)) return null;

    try {
        const logoEmpresa = procesarLogoEmpresa(empresaInfo);
        const logoCustom = procesarLogoCustom(logoConfig.rightLogoData);

        // Si no hay imagenes disponibles y se requieren, no explota, pone vacío
        const leftImgRun = (logoConfig.left && logoEmpresa) ? crearImageRunHeader(logoEmpresa) : null;

        let rightImgData = null;
        if (logoConfig.right) {
            if (logoCustom) rightImgData = logoCustom;
            else if (logoEmpresa) rightImgData = logoEmpresa;
        }
        const rightImgRun = rightImgData ? crearImageRunHeader(rightImgData) : null;

        // Construir celdas
        const cellLeft = new TableCell({
            children: [new Paragraph({ children: leftImgRun ? [leftImgRun] : [] })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }
        });

        const cellRight = new TableCell({
            children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: rightImgRun ? [rightImgRun] : []
            })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }
        });

        const table = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
            rows: [new TableRow({ children: [cellLeft, cellRight] })]
        });

        return {
            default: new Header({
                children: [table, new Paragraph({ text: "", spacing: { after: 200 } })]
            })
        };

    } catch (e) {
        console.error("Error construyendo header logos:", e);
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
    const unAnio = new Date(hoy);
    unAnio.setFullYear(hoy.getFullYear() + 1);
    unAnio.setDate(unAnio.getDate() - 1);
    variables['FECHA_ACTUAL_1_ANIO'] = formatearFechaEspanol(unAnio.toISOString().split("T")[0]);

    const seisMeses = new Date(hoy);
    seisMeses.setMonth(hoy.getMonth() + 6);
    seisMeses.setDate(seisMeses.getDate() - 1);
    variables['FECHA_ACTUAL_6_MESES'] = formatearFechaEspanol(seisMeses.toISOString().split("T")[0]);

    const unMes = new Date(hoy);
    unMes.setMonth(hoy.getMonth() + 1);
    unMes.setDate(unMes.getDate() - 1);
    variables['FECHA_ACTUAL_1_MES'] = formatearFechaEspanol(unMes.toISOString().split("T")[0]);

    return variables;
}

// ========== LOGICA CONDICIONAL Y VARIABLES ==========

function evaluarCondicional(conditionalVar, variables) {
    if (!conditionalVar || conditionalVar.trim() === '') return true;

    // Quitar [[IF: y ]] si vienen
    let condicion = conditionalVar.replace(/^(\[\[IF:|{{)(.*?)(]])?$/i, '$2').trim();

    // 1. OR ||
    if (condicion.includes('||')) {
        const parts = condicion.split('||').map(p => p.trim());
        for (const part of parts) {
            if (evaluarCondicional(part, variables)) return true;
        }
        return false;
    }

    // 2. AND &&
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
                    bold: true,
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
            let valor = variables[varName] !== undefined ? variables[varName] : variables[rawVarName];

            if (valor === undefined) valor = `[${rawVarName}]`;

            if (esCampoDeFecha(rawVarName) && valor && !valor.includes('[')) {
                try { valor = formatearFechaEspanol(valor); } catch (e) { }
            }

            // Lógica de Mayúsculas/Minúsculas según cómo se escribió la variable en el editor
            let fianlText = String(valor);
            const isUpper = rawVarName === rawVarName.toUpperCase() && /[a-zA-Z]/.test(rawVarName);
            const isLower = rawVarName === rawVarName.toLowerCase() && /[a-zA-Z]/.test(rawVarName);

            if (isUpper) {
                fianlText = fianlText.toUpperCase();
            } else if (isLower) {
                fianlText = fianlText.toLowerCase();
            }

            runs.push(new TextRun({
                text: fianlText,
                bold: estiloBase.bold, // Respetar negrita del editor, no forzar
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

    let cleanHtml = html
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<br\s*\/?>/gi, '\n');

    const contadorNumeral = { valor: 1 };
    const children = [];

    const regexBloques = /<(p|table)[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;

    const condicionalStack = [];
    const debeMostrar = () => condicionalStack.every(v => v === true);

    if (!cleanHtml.match(/<(p|table)/i)) {
        cleanHtml = `<p>${cleanHtml}</p>`;
    }

    function parsearEstilosInline(htmlTag) {
        const tagNormalized = htmlTag.replace(/'/g, '"').replace(/\s+/g, ' ');
        const styleMatch = tagNormalized.match(/style="([^"]*)"/i);
        const classMatch = tagNormalized.match(/class="([^"]*)"/i);
        const styles = { textAlign: AlignmentType.JUSTIFIED };

        if (styleMatch && styleMatch[1]) {
            const styleStr = styleMatch[1].toLowerCase();
            if (styleStr.includes('text-align:center') || styleStr.includes('text-align: center')) styles.textAlign = AlignmentType.CENTER;
            else if (styleStr.includes('text-align:right') || styleStr.includes('text-align: right')) styles.textAlign = AlignmentType.RIGHT;
            else if (styleStr.includes('text-align:left') || styleStr.includes('text-align: left')) styles.textAlign = AlignmentType.LEFT;
            else if (styleStr.includes('text-align:justify') || styleStr.includes('text-align: justify')) styles.textAlign = AlignmentType.JUSTIFIED;
        }

        if (classMatch && classMatch[1]) {
            const classStr = classMatch[1].toLowerCase();
            if (classStr.includes('center')) styles.textAlign = AlignmentType.CENTER;
            else if (classStr.includes('right')) styles.textAlign = AlignmentType.RIGHT;
            else if (classStr.includes('left')) styles.textAlign = AlignmentType.LEFT;
            else if (classStr.includes('justify')) styles.textAlign = AlignmentType.JUSTIFIED;
        }

        return styles;
    }

    while ((match = regexBloques.exec(cleanHtml)) !== null) {
        const fullTag = match[0];
        const tagName = match[1].toLowerCase();
        const innerContent = match[2];

        let textoPlano = innerContent.replace(/<[^>]*>/g, '');
        textoPlano = textoPlano.replace(/&nbsp;/g, ' ').trim();

        const matchIf = textoPlano.match(/^\[\[\s*IF:(.*?)\s*\]\]$/i);
        const matchEndIf = textoPlano.match(/^\[\[\s*ENDIF\s*\]\]$/i);

        if (matchIf) {
            const condicion = matchIf[1];
            const resultado = evaluarCondicional(condicion, variables);
            condicionalStack.push(resultado);
            continue;
        }

        if (matchEndIf) {
            condicionalStack.pop();
            continue;
        }

        if (!debeMostrar()) continue;

        if (tagName === 'p') {
            const style = parsearEstilosInline(fullTag);

            const parts = innerContent.split(/(<\/?(?:strong|b|em|i|u|span(?:\s+[^>]*)?)>)/gi);
            const paragraphChildren = [];

            let currentSpanStyle = { ...style };
            const baseSize = currentSpanStyle.size; // Guardar tamaño base del párrafo si existe

            for (const part of parts) {
                if (!part) continue;
                const lower = part.toLowerCase();

                // Detección de Tags
                if (lower.startsWith('<strong>') || lower.startsWith('<b>')) { currentSpanStyle.bold = true; continue; }
                if (lower.startsWith('</strong>') || lower.startsWith('</b>')) { currentSpanStyle.bold = false; continue; }
                if (lower.startsWith('<em>') || lower.startsWith('<i>')) { currentSpanStyle.italics = true; continue; }
                if (lower.startsWith('</em>') || lower.startsWith('</i>')) { currentSpanStyle.italics = false; continue; }
                if (lower.startsWith('<u>')) { currentSpanStyle.underline = true; continue; }
                if (lower.startsWith('</u>')) { currentSpanStyle.underline = false; continue; }

                // Soporte para SPAN con font-size
                if (lower.startsWith('<span')) {
                    const styleMatch = lower.match(/style="([^"]*)"/i);
                    if (styleMatch && styleMatch[1]) {
                        const stylesStr = styleMatch[1];
                        const sizeMatch = stylesStr.match(/font-size:\s*([\d\.]+)(pt|px)/i);
                        if (sizeMatch) {
                            let val = parseFloat(sizeMatch[1]);
                            const unit = sizeMatch[2];
                            if (unit === 'pt') {
                                currentSpanStyle.size = Math.round(val * 2);
                            } else if (unit === 'px') {
                                currentSpanStyle.size = Math.round(val * 1.5);
                            }
                        }
                    }
                    continue;
                }

                if (lower.startsWith('</span>')) {
                    // Restaurar tamaño base al cerrar span
                    if (baseSize) currentSpanStyle.size = baseSize;
                    else delete currentSpanStyle.size;
                    continue;
                }

                const runs = reemplazarVariablesEnTexto(part, variables, currentSpanStyle, contadorNumeral);
                paragraphChildren.push(...runs);
            }

            const textContent = innerContent.replace(/<[^>]*>/g, '').trim();
            const isObercase = textContent === textContent.toUpperCase() && textContent.length > 0;
            const isShort = textContent.length < 100;
            const isNumeral = /^(PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|SÉPTIMO|OCTAVO|NOVENO|DÉCIMO|UNDÉCIMO|DUODÉCIMO|DECIMOTERCERO)/i.test(textContent);

            const shouldKeepNext = (isObercase && isShort) || isNumeral;

            children.push(new Paragraph({
                alignment: style.textAlign,
                children: paragraphChildren,
                spacing: { after: 120 },
                keepNext: shouldKeepNext,
                keepLines: shouldKeepNext
            }));
        }
        else if (tagName === 'table') {
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
                    const tdText = tdContent.replace(/<[^>]*>/g, '');
                    const tdRuns = reemplazarVariablesEnTexto(tdText, variables, { size: 24 }, contadorNumeral);

                    cells.push(new TableCell({
                        children: [new Paragraph({ children: tdRuns })],
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
    return reemplazarVariablesEnTexto(contenido, variables, { size: 24 }, null);
}

async function generarDocumentoDesdePlantilla(responses, responseId, db, plantilla, userData, formTitle) {
    try {
        console.log("=== GENERANDO DOCUMENTO (TIPTAP SYSTEM) ===");
        const variables = await extraerVariablesDeRespuestas(responses, userData, db);
        const empresaInfo = await obtenerEmpresaDesdeBD(userData?.empresa || '', db);

        // --- HEADER LOGOS (Generados mediante helpers) ---
        const header = construirHeaderLogos(plantilla.logoConfig, empresaInfo);

        // --- BODY ---
        const children = [];

        // 2. CONTENIDO PRINCIPAL
        if (plantilla.documentContent) {
            const bloquesHTML = procesarHTML(plantilla.documentContent, variables);
            children.push(...bloquesHTML);
        } else if (plantilla.paragraphs) {
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

        // 3. FIRMAS (TABLA 2 COLUMNAS - DINÁMICA)
        let signatures = plantilla.signatures;

        // Fallback para plantillas antiguas que usan signature1Text/signature2Text
        if (!signatures || !Array.isArray(signatures) || signatures.length === 0) {
            signatures = [];
            if (plantilla.signature1Text) {
                signatures.push({
                    title: plantilla.signature1Title || "Empleador / Representante Legal",
                    text: plantilla.signature1Text
                });
            }
            if (plantilla.signature2Text) {
                signatures.push({
                    title: plantilla.signature2Title || "Empleado",
                    text: plantilla.signature2Text
                });
            }
        }

        if (plantilla.includeSignature !== false && signatures.length > 0) {
            children.push(new Paragraph({ text: "", spacing: { before: 800 } }));

            const procesarFirma = (textoFirma, styleOpts) => {
                const parrafosFirma = [];
                if (!textoFirma) return parrafosFirma;

                const lineas = textoFirma.split(/\r?\n/);
                const baseStyles = styleOpts || { size: 24, bold: false };

                for (let i = 0; i < lineas.length; i++) {
                    const linea = lineas[i];

                    // Filtro solo para evitar líneas de firma duplicadas si el usuario las puso manual
                    if (linea.trim().match(/^_+$/)) {
                        continue;
                    }

                    if (linea.trim() === '__________________________') {
                        parrafosFirma.push(new Paragraph({
                            children: [new TextRun({ text: linea, bold: true, size: 24 })],
                            alignment: AlignmentType.CENTER
                        }));
                        continue;
                    }

                    const runOpts = { ...baseStyles };
                    const runsLinea = reemplazarVariablesEnTexto(linea, variables, runOpts, null);

                    parrafosFirma.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: runsLinea,
                        spacing: { after: 0 },
                        keepWithNext: true
                    }));
                }
                return parrafosFirma;
            };

            const generarBloqueFirma = (sig) => {
                const titleText = sig.title || "Firma";

                // Configurar estilos del texto (contenido)
                const textStyles = {
                    size: 24,
                    bold: !!sig.textBold,
                    italics: !!sig.textItalic,
                    underline: sig.textUnderline ? { type: "single" } : undefined
                };

                const dynamicContent = procesarFirma(sig.text, textStyles);

                return [
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: "__________________________", bold: true, size: 24 })],
                        spacing: { after: 120 },
                        keepWithNext: true
                    }),
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({
                            text: titleText,
                            bold: !!sig.titleBold,
                            italics: !!sig.titleItalic,
                            underline: sig.titleUnderline ? { type: "single" } : undefined,
                            size: 24
                        })],
                        spacing: { after: 0 },
                        keepWithNext: true
                    }),
                    ...dynamicContent
                ];
            };

            const borderNone = {
                style: BorderStyle.NONE,
                size: 0,
                color: "FFFFFF"
            };

            const bordersNoneConfig = {
                top: borderNone,
                bottom: borderNone,
                left: borderNone,
                right: borderNone,
                insideHorizontal: borderNone,
                insideVertical: borderNone
            };

            // Generar Filas (Iterar de 2 en 2)
            const tableRows = [];
            for (let i = 0; i < signatures.length; i += 2) {
                const sig1 = signatures[i];
                const sig2 = signatures[i + 1];

                if (!sig2) {
                    // Si es impar y es el último, centrar usando columnSpan 2
                    tableRows.push(new TableRow({
                        cantSplit: true,
                        children: [
                            new TableCell({
                                columnSpan: 2,
                                children: generarBloqueFirma(sig1),
                                borders: bordersNoneConfig,
                            })
                        ]
                    }));
                } else {
                    const cell1Children = generarBloqueFirma(sig1);
                    const cell2Children = generarBloqueFirma(sig2);

                    tableRows.push(new TableRow({
                        cantSplit: true,
                        children: [
                            new TableCell({
                                children: cell1Children,
                                borders: bordersNoneConfig,
                            }),
                            new TableCell({
                                children: cell2Children,
                                borders: bordersNoneConfig,
                            })
                        ]
                    }));
                }
            }

            children.push(new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                columnWidths: [4600, 4600],
                alignment: AlignmentType.CENTER,
                borders: bordersNoneConfig,
                rows: tableRows
            }));
        }

        const doc = new Document({
            sections: [{
                properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
                headers: header || undefined,
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
            // DEBUG: Write error
            try {
                const fs = require('fs');
                const path = require('path');
                // fs.writeFileSync(path.join(process.cwd(), 'debug_error.txt'), error.stack || error.toString());
            } catch (e) { }
            return await generarDocumentoTxt(responses, responseId, db, formTitle);
        }
    } else {
        console.log(`[GENERADOR] No se encontró plantilla para formId: ${formId}`);
    }

    return await generarDocumentoTxt(responses, responseId, db, formTitle);
}

module.exports = {
    generarAnexoDesdeRespuesta,
    generarDocumentoTxt,
    buscarPlantillaPorFormId,
    evaluarCondicional,
    reemplazarVariablesEnContenido
};