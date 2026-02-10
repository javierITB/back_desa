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

const app = express();

// Configuración CORS
app.use(cors());

// CONFIGURACIÓN PARA VERCEL (Límites de carga)
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '4mb', extended: true }));

app.set('trust proxy', true);

// --- CONFIGURACIÓN DE CONEXIÓN DINÁMICA A MONGODB ---

const client = new MongoClient(process.env.MONGO_URI);
const dbCache = {}; // Almacena instancias de DB para reutilizarlas

/**
 * Función para obtener o crear la instancia de DB basada en el tenant
 */
async function getTenantDB(tenantName) {
  // Asegurar que el cliente de MongoDB está conectado
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }

  // Mapeo: si es "api" usamos la DB por defecto, de lo contrario usamos el nombre del tenant
  const dbName = (tenantName === "api" || tenantName === "infodesa" || !tenantName) ? "formsdb" : tenantName;

  // Retornar de caché si ya existe para ahorrar recursos
  if (dbCache[dbName]) {
    return dbCache[dbName];
  }

  // Si no existe, creamos la instancia y la guardamos
  const dbInstance = client.db(dbName);
  dbCache[dbName] = dbInstance;

  console.log(`Base de datos activa: ${dbName}`);
  return dbInstance;
}

// --- ESTRUCTURA DE RUTAS DINÁMICAS ---

// Creamos un Router con mergeParams para que los hijos vean el parámetro :company
const tenantRouter = express.Router({ mergeParams: true });

// Middleware Multi-tenant: se ejecuta en cada petición antes de las rutas
tenantRouter.use(async (req, res, next) => {
  try {
    const { company } = req.params;
    // Inyectamos la base de datos específica en el objeto request
    req.db = await getTenantDB(company);
    next();
  } catch (err) {
    console.error("Error crítico de conexión Multi-tenant:", err);
    res.status(500).json({ error: "Error interno con la base de datos de la empresa" });
  }
});

// Montaje final: todas las rutas ahora requieren un prefijo (ej: /acciona/auth)
app.use((req, res, next) => {
  req.mongoClient = client;
  next();
});

const sasRoutes = require("./endpoints/SAS");
app.use(["/sas", "/api/sas"], sasRoutes);

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