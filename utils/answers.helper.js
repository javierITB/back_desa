const { getActor } = require("./registerEvent.helper");
const { formatActor } = require("./registerEvent.helper");

function getRequestSentMetadata(currentDate) {
   return [
      {
         id: 1,
         title: "Solicitud Enviada",
         description: "La solicitud ha sido enviada y está pendiente de revisión inicial.",
         status: "completed",
         completedAt:  currentDate,
         assignedTo: "Sistema Automático",
         notes: "Solicitud recibida correctamente.",
      },
   ];
}
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

async function getApprovedMetadata(req, auth) {
   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   // const filesUploadedMetadata = {
   //    title: `Archivos corregidos subidos`,
   //    description: `Se han subido ${filesLength} archivo(s) corregidos a la solicitud.`,
   //    status: "completed",
   //    completedAt: new Date(),
   //    assignedTo: formattedActor,
   // };

   const approvedMetadata = {
      title: "Solicitud Aprobada",
      description: "La solicitud ha sido aprobada y está lista para ser firmada por el cliente.",
      status: "completed",
      completedAt: new Date(),
      assignedTo: formattedActor,
   };

   return approvedMetadata;
}

async function getFirmadoMetadata(req, auth, currentDate) {
   const actor = await getActor(req, auth);

   return {
      title: "Solicitud Firmada",
      description: "La solicitud ha sido firmada por el cliente.",
      status: "completed",
      completedAt: currentDate,
      assignedTo: formatActor(actor),
      notes: "Documento recibido correctamente.",
   }
}

async function getFirmaEliminadaMetadata(req, auth, currentDate) {
   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   return {
      title: "Cambio de estado a aprobado | Firma eliminada",
      description:
         "La firma del cliente ha sido eliminada y la solicitud ha vuelto a estado aprobado.",
      status: "completed",
      completedAt: currentDate,
      assignedTo: formattedActor,
   };
}

async function getFilesUploadedMetadata(req, auth, filesCount, date) {
   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   return {
      title: "Archivos corregidos subidos",
      description: `Se han subido ${filesCount} archivo(s) corregidos a la solicitud.`,
      status: "completed",
      completedAt: date,
      assignedTo: formattedActor,
   };
}

async function getCorrectedFilesDeletedMetadata(req, auth, fileNames, date) {
   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   const count = fileNames.length;

   return {
      title: "Archivos corregidos eliminados",
      description:
         count === 1
            ? `Se eliminó 1 archivo corregido de la solicitud.`
            : `Se eliminaron ${count} archivos corregidos de la solicitud.`,
      status: "completed",
      completedAt: date,
      assignedTo: formattedActor,
      files: fileNames,
   };
}


async function getCorrectionsClearedMetadata(req, auth, date) {
   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   return {
      title: "Correcciones eliminadas completamente",
      description:
         "Se eliminaron todas las correcciones. La solicitud vuelve a revisión.",
      status: "completed",
      completedAt: date,
      assignedTo: formattedActor,
   };
}

async function getFinalizedMetadata(req, auth, date) {

   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   return {
      title: "Solicitud Finalizada",
      description:
         "La solicitud ha sido finalizada y el proceso ha concluido.",
      status: "completed",
      completedAt: date,
      assignedTo: formattedActor,
   };

}

async function getArchivedMetadata(req, auth, date) {

   const actor = await getActor(req, auth);
   const formattedActor = formatActor(actor);

   return {
      title: "Solicitud Archivada",
      description:
         "La solicitud ha sido archivada y ya no admite modificaciones.",
      status: "completed",
      completedAt: date,
      assignedTo: formattedActor,
   };

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
   getApprovedMetadata,
   getRequestSentMetadata,
   getFirmadoMetadata,
   getFirmaEliminadaMetadata,
   getFilesUploadedMetadata,
   getCorrectedFilesDeletedMetadata,
   getCorrectionsClearedMetadata,
   getFinalizedMetadata,
   getArchivedMetadata
};
