const { getActor, encryptObject, formatActor, formatEncriptedName, formatName } = require("./registerEvent.helper.js");
const { encrypt, decrypt } = require("../utils/seguridad.helper");

async function registerEvent(req, auth, event, metadata = {}, descriptionBuilder = null, actorOverride = null) {
   const actor = actorOverride ?? (await getActor(req, auth));

   const description = typeof descriptionBuilder === "function" ? descriptionBuilder(actor) || "" : event?.description;
   const finalDescription =
      typeof description === "string" && description.trim() !== "" && !description.includes(":")
         ? encrypt(description)
         : description;

   const payload = {
      ...event,
      actor,
      description: finalDescription,
      metadata: metadata && Object.keys(metadata).length ? encryptObject(metadata) : metadata,
      createdAt: new Date(),
   };

   const collection = req.db.collection("cambios");
   const result = await collection.insertOne(payload);

   if (!result.insertedId) {
      throw new Error("Error al registrar evento");
   }
}

async function registerSolicitudCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.SOLICITUD_CREACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
      description,
   };

   await registerEvent(req, auth, payload, metadata);
}

async function registerSolicitudRemovedEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} eliminó una solicitud`;

   const payload = {
      code: CODES.SOLICITUD_ELIMINACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerTicketCreationEvent(req, auth, description = "", metadata = {}) {
   const payload = {
      code: CODES.TICKET_CREACION,
      target: {
         type: TARGET_TYPES.TICKET,
      },
      description,
   };

   await registerEvent(req, auth, payload, metadata);
}

async function registerTicketRemovedEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} eliminó un ticket`;
   const payload = {
      code: CODES.TICKET_ELIMINACION,
      target: {
         type: TARGET_TYPES.TICKET,
      },
   };
   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerDomicilioVirtualRemovalEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} eliminó una solicitud de domicilio virtual`;
   const payload = {
      code: CODES.DOMICILIOV_ELIMINACION,
      target: {
         type: TARGET_TYPES.SOLICITUD,
      },
   };
   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerUserUpdateEvent(req, auth, profileData = {}) {
   const { nombre, apellido, mail, empresa, cargo, rol, estado } = profileData;
   const metadata = { Usuario: { nombre, apellido, mail, empresa, cargo, rol, estado } };

   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} actualizó un perfil de usuario`;
   const payload = {
      code: CODES.USUARIO_ACTUALIZACION,
      target: {
         type: TARGET_TYPES.USUARIO,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerUserCreationEvent(req, auth, profileData = {}) {
   const { nombre, apellido, mail, empresa, cargo, rol, estado } = profileData;
   const metadata = { Usuario: { nombre, apellido, mail, empresa, cargo, rol, estado } };

   const descriptionBuilder = (actor) =>
      `${formatActor(actor)} creó el usuario ${formatName(nombre, apellido)}`;

   const payload = {
      code: CODES.USUARIO_CREACION,
      target: {
         type: TARGET_TYPES.USUARIO,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerUserRemovedEvent(req, auth, deletedUser = {}) {
   const { nombre, apellido, mail, empresa, cargo, rol, estado } = deletedUser;

   const nameDecrypted = decrypt(nombre);
   const lastNameDecrypted = decrypt(apellido);

   const metadata = {
      usuario_eliminado: {
         nombre: nameDecrypted,
         apellido: lastNameDecrypted,
         email: decrypt(mail),
         empresa: decrypt(empresa),
         cargo: decrypt(cargo),
         rol,
         estado,
      },
   };

   const descriptionBuilder = (actor) =>
      `${formatActor(actor)} eliminó al usuario ${formatName(nameDecrypted, lastNameDecrypted)}`;

   const payload = {
      code: CODES.USUARIO_ELIMINACION,
      target: {
         type: TARGET_TYPES.USUARIO,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerEmpresaCreationEvent(req, auth, empresaData = {}) {
   const { nombre, rut, direccion, encargado, rut_encargado } = empresaData;
   const metadata = { Empresa: { nombre, rut, direccion, encargado, rut_encargado } };

   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} registró una nueva empresa`;

   const payload = {
      code: CODES.EMPRESA_CREACION,
      target: {
         type: TARGET_TYPES.EMPRESA,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerEmpresaUpdateEvent(req, auth, empresaData = {}) {
   const { nombre, rut, direccion, encargado, rut_encargado } = empresaData;
   const metadata = { Empresa: { nombre, rut, direccion, encargado, rut_encargado } };

   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} actualizó una empresa`;

   const payload = {
      code: CODES.EMPRESA_ACTUALIZACION,
      target: {
         type: TARGET_TYPES.EMPRESA,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerEmpresaRemovedEvent(req, auth, metadata = {}) {
   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} eliminó una empresa`;
   const payload = {
      code: CODES.EMPRESA_ELIMINACION,
      target: {
         type: TARGET_TYPES.EMPRESA,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

async function registerUserPasswordChange(req, userData) {
   const actorOverride = {
      uid: userData?._id?.toString() || null,
      name: userData?.nombre || "desconocido",
      last_name: userData?.apellido || "desconocido",
      role: userData?.rol || "desconocido",
      email: userData?.mail || "desconocido",
      empresa: userData?.empresa || "desconocido",
      cargo: userData?.cargo || "desconocido",
      estado: userData?.estado || "desconocido",
   };

   const description = `${decrypt(userData?.nombre) || "desconocido"} ${decrypt(userData?.apellido) || "desconocido"} cambió su contraseña`;

   const payload = {
      code: CODES.USUARIO_CAMBIO_CONTRASEÑA,
      target: {
         type: TARGET_TYPES.USUARIO,
      },
      description,
   };

   await registerEvent(req, null, payload, {}, null, actorOverride);
}

async function registerCargoCreationEvent(req, auth, cargoData) {
   const { name, description, permissions } = cargoData;
   const metadata = { Cargo: { Nombre: name, Descripcion: description, Permisos: permissions } };

   const descriptionBuilder = (actor) =>
      `${decrypt(actor?.name) || "desconocido"} ${decrypt(actor?.last_name) || ""} ha creado el cargo "${name}"`;

   const payload = {
      code: CODES.CARGO_CREACION,
      target: {
         type: TARGET_TYPES.CARGO,
      },
   };

   await registerEvent(req, auth, payload, metadata, descriptionBuilder);
}

// codes
const CODES = {
   SOLICITUD_CREACION: "SOLICITUD_CREACION",
   SOLICITUD_ELIMINACION: "SOLICITUD_ELIMINACION",
   TICKET_CREACION: "TICKET_CREACION",
   TICKET_ELIMINACION: "TICKET_ELIMINACION",
   DOMICILIOV_ELIMINACION: "DOMICILIOV_ELIMINACION",
   USUARIO_CREACION: "USUARIO_CREACION",
   USUARIO_ACTUALIZACION: "USUARIO_ACTUALIZACION",
   USUARIO_ELIMINACION: "USUARIO_ELIMINACION",
   USUARIO_CAMBIO_CONTRASEÑA: "USUARIO_CAMBIO_CONTRASEÑA",
   EMPRESA_CREACION: "EMPRESA_CREACION",
   EMPRESA_ACTUALIZACION: "EMPRESA_ACTUALIZACION",
   EMPRESA_ELIMINACION: "EMPRESA_ELIMINACION",
   CARGO_CREACION: "CARGO_CREACION",
   CARGO_ACTUALIZACION: "CARGO_ACTUALIZACION",
};

// target types
const TARGET_TYPES = {
   SOLICITUD: "Solicitud",
   TICKET: "Ticket",
   USUARIO: "Usuario",
   EMPRESA: "Empresa",
   CARGO: "Cargo",
};

module.exports = {
   registerSolicitudCreationEvent,
   registerTicketCreationEvent,
   registerSolicitudRemovedEvent,
   registerTicketRemovedEvent,
   registerDomicilioVirtualRemovalEvent,
   registerUserUpdateEvent,
   registerUserCreationEvent,
   registerUserRemovedEvent,
   registerEmpresaCreationEvent,
   registerEmpresaUpdateEvent,
   registerEmpresaRemovedEvent,
   registerUserPasswordChange,
   registerCargoCreationEvent,
};
