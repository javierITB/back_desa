const { encrypt, decrypt } = require("../utils/seguridad.helper");
const { getActor } = require("./registerEvent.helper");
const { formatActor } = require("./registerEvent.helper");

async function getChangeStatusMetadata(req, auth, status) {
   if (!status) return {};

   const formatedStatus = formatText(status);

   const actor = await getActor(req, auth);

   const statusMetadata = {
      title: `Cambio de estado a "${formatedStatus}"`,
      description: `Se ha cambiado el estado de la solicitud a "${formatedStatus}".`,
      status: "completed",
      completedAt: new Date(),
      assignedTo: formatActor(actor),
   };

   return statusMetadata || {};
}

function formatText(text) {
   const formatted = text.replace(/_/g, " ");
   return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const mockTimeline = [
   {
      id: 1,
      title: "Solicitud Enviada",
      description: "La solicitud ha sido enviada y está pendiente de revisión inicial.",
      status: "completed",
      completedAt: "2025-01-18T09:30:00Z",
      assignedTo: "Sistema Automático",
      notes: "Solicitud recibida correctamente.",
   },
   {
      id: 2,
      title: "Revisión Inicial",
      description: "El equipo de RR.HH. está realizando la revisión inicial.",
      status: "completed",
      completedAt: "2025-01-22T17:00:00Z",
      assignedTo: "María González",
      estimatedCompletion: "2025-01-22T17:00:00Z",
   },
   {
      id: 3,
      title: "Aprobación Final",
      description: "La solicitud ha sido aprobada por el responsable.",
      status: "completed",
      completedAt: "2025-01-23T10:00:00Z",
      assignedTo: "María González",
      estimatedCompletion: "2025-01-22T17:00:00Z",
   },
   {
      id: 4,
      title: "cierre de la solicitud",
      description: "La solicitud ha sido cerrada por el responsable.",
      status: "current",
      completedAt: null,
      assignedTo: "María González",
      estimatedCompletion: "2025-01-22T17:00:00Z",
   },
];

module.exports = {
   getChangeStatusMetadata,
};
