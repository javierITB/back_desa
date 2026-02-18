const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

// Importar rutas
const authRoutes = require("./endpoints/auth");
const formRoutes = require("./endpoints/forms");
const answersRoutes = require("./endpoints/answers");
const mailRoutes = require("./endpoints/mail");
const gen = require("./endpoints/Generador");
const noti = require("./endpoints/notificaciones");
const menu = require("./endpoints/web");
const plantillas = require("./endpoints/plantillas");
const anunciosRouter = require("./endpoints/anuncios");
const soporteRoutes = require("./endpoints/soporte");
const domicilioVirtualRoutes = require("./endpoints/domicilioVirtual");
const configTicketsRoutes = require("./endpoints/configTickets");
const dashboardRoutes = require("./endpoints/dashboard");
const registroRoutes = require("./endpoints/registro");
const roles = require("./endpoints/roles");
const pagosRoutes = require("./endpoints/pagos");

const app = express();

// Configuración CORS
app.use(cors());

// CONFIGURACIÓN PARA VERCEL (Límites de carga)
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 if needed, though we use multer
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.set('trust proxy', true);

// ... (existing code) ...

// Definición de todos los endpoints bajo el control del tenantRouter
tenantRouter.use("/auth", authRoutes);
tenantRouter.use("/forms", formRoutes);
tenantRouter.use("/respuestas", answersRoutes);
tenantRouter.use("/mail", mailRoutes);
tenantRouter.use("/generador", gen);
tenantRouter.use("/noti", noti);
tenantRouter.use("/menu", menu);
tenantRouter.use("/plantillas", plantillas);
tenantRouter.use("/anuncios", anunciosRouter);
tenantRouter.use("/soporte", soporteRoutes);
tenantRouter.use("/domicilio-virtual", domicilioVirtualRoutes);
tenantRouter.use("/config-tickets", configTicketsRoutes);
tenantRouter.use("/dashboard", dashboardRoutes);
tenantRouter.use("/registro", registroRoutes);
tenantRouter.use("/roles", roles);
tenantRouter.use("/pagos", pagosRoutes);



app.use("/:company", tenantRouter);

// Ruta raíz para verificación simple
app.get("/", (req, res) => {
  res.json({
    message: "API Multi-tenant de Solunex funcionando",
    status: "online"
  });
});

// Manejo de errores global para rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada o empresa no especificada correctamente" });
});

module.exports = app;