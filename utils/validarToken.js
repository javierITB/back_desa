const { createBlindIndex, decrypt, encrypt } = require("./seguridad.helper");

async function validarToken(db, token) {
    // 1. Buscar el token (el campo 'token' no está cifrado)
    const tokenData = await db.collection("tokens").findOne({
        "token": token
    });

    if (!tokenData) {
        return { ok: false, reason: "No existe" };
    }

    // 2. Verificar que esté activo
    let activeDescifrado = false;
    try {
        if (tokenData.active && tokenData.active.includes(':')) {
            const activeStr = decrypt(tokenData.active);
            activeDescifrado = activeStr === "true";
        } else {
            activeDescifrado = tokenData.active === true;
        }
    } catch (error) {
        console.error('Error descifrando campo active:', error);
        return { ok: false, reason: "Error de cifrado en active" };
    }

    if (!activeDescifrado) {
        return { ok: false, reason: "Token inactivo o revocado" };
    }

    const ahora = new Date();
    const expiracion = new Date(tokenData.expiresAt || tokenData.expiration);

    // 3. Verificar expiración
    if (ahora > expiracion) {
        try {
            await db.collection("tokens").updateOne(
                { _id: tokenData._id },
                {
                    $set: {
                        active: encrypt("false"),
                        revokedAt: ahora
                    }
                }
            );
        } catch (error) {
            console.error('Error al desactivar token expirado:', error);
        }
        return { ok: false, reason: "Expirado y revocado" };
    }

    // 5. Si el token existe, está activo y no ha expirado, es válido.
    let emailDescifrado = null;
    let rolDescifrado = null;

    try {
        if (tokenData.email && tokenData.email.includes(':')) {
            emailDescifrado = decrypt(tokenData.email);
        } else {
            emailDescifrado = tokenData.email;
        }

        if (tokenData.rol && tokenData.rol.includes(':')) {
            rolDescifrado = decrypt(tokenData.rol);
        } else {
            rolDescifrado = tokenData.rol;
        }
    } catch (error) {
        console.error('Error descifrando datos del token:', error);
    }

    return {
        ok: true,
        data: {
            _id: tokenData._id,
            email: emailDescifrado,
            rol: rolDescifrado,
            createdAt: tokenData.createdAt,
            expiresAt: tokenData.expiresAt
        }
    };
}

module.exports = { validarToken };
