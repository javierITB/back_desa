/**
 * Mapeo de Grupos de Permisos 
 */
const PERMISSION_GROUPS = {
    // --- CONTROLADORES RAÍZ ---
    acceso_panel_cliente: {
        label: "Panel: Cliente",
        tagg: "root",
        permissions: [{ id: "view_panel_cliente", label: "Habilitar Panel de Cliente" }],
    },
    acceso_panel_admin: {
        label: "Panel: Administración",
        tagg: "root",
        permissions: [{ id: "view_panel_admin", label: "Habilitar Panel de Administración" }],
    },
    // --- VISTAS TAGG: ADMIN ---
    solicitudes_clientes: {
        label: "Vista: Solicitudes de Clientes",
        tagg: "admin",
        permissions: [
            { id: "view_solicitudes_clientes", label: "Acceso a la vista" },
            { id: "delete_solicitudes_clientes", label: "Eliminar solicitudes de clientes" },
            { id: "view_solicitudes_clientes_details", label: "Acceso a detalles de solicitudes de clientes" },
            {
                id: "view_solicitudes_clientes_answers",
                label: "Ver respuestas de solicitud de clientes",
                dependency: "view_solicitudes_clientes_details",
            },
            {
                id: "view_solicitudes_clientes_shared",
                label: "Ver usuarios compartidos",
                dependency: "view_solicitudes_clientes_details",
            },

            { id: "view_solicitudes_clientes_messages", label: "Acceso a mensajes de solicitudes de clientes" },
            {
                id: "create_solicitudes_clientes_messages",
                label: "Crear mensajes de solicitudes de clientes",
                dependency: "view_solicitudes_clientes_messages",
            },
            {
                id: "create_solicitudes_clientes_messages_mail",
                label: "Crear mensajes de solicitudes de clientes con mail",
                dependency: "view_solicitudes_clientes_messages",
            },
            {
                id: "view_solicitudes_clientes_messages_admin",
                label: "Acceso a mensajes internos de solicitudes de clientes",
                dependency: "view_solicitudes_clientes_messages",
            },
            {
                id: "create_solicitudes_clientes_messages_admin",
                label: "Crear mensajes internos en solicitudes de clientes",
                dependency: "view_solicitudes_clientes_messages_admin",
            },

            {
                id: "view_solicitudes_clientes_attach",
                label: "Ver documento adjunto",
                dependency: "view_solicitudes_clientes_details",
            },
            {
                id: "download_solicitudes_clientes_attach",
                label: "Descargar documento adjunto",
                dependency: "view_solicitudes_clientes_attach",
            },
            {
                id: "preview_solicitudes_clientes_attach",
                label: "vista previa documento adjunto",
                dependency: "view_solicitudes_clientes_attach",
            },
            {
                id: "delete_solicitudes_clientes_attach",
                label: "Eliminar documento adjunto",
                dependency: "view_solicitudes_clientes_attach",
            },

            {
                id: "view_solicitudes_clientes_generated",
                label: "Ver documento generado",
                dependency: "view_solicitudes_clientes_details",
            },
            {
                id: "download_solicitudes_clientes_generated",
                label: "Descargar documento generado",
                dependency: "view_solicitudes_clientes_generated",
            },
            {
                id: "preview_solicitudes_clientes_generated",
                label: "vista previa documento generado",
                dependency: "view_solicitudes_clientes_generated",
            },
            {
                id: "regenerate_solicitudes_clientes_generated",
                label: "Regenerar documento",
                dependency: "view_solicitudes_clientes_generated",
            },

            {
                id: "view_solicitudes_clientes_send",
                label: "Ver documento enviado",
                dependency: "view_solicitudes_clientes_details",
            },
            {
                id: "download_solicitudes_clientes_send",
                label: "Descargar documento enviado",
                dependency: "view_solicitudes_clientes_send",
            },
            {
                id: "preview_solicitudes_clientes_send",
                label: "vista previa documento enviado",
                dependency: "view_solicitudes_clientes_send",
            },
            {
                id: "delete_solicitudes_clientes_send",
                label: "Eliminar documento enviado",
                dependency: "view_solicitudes_clientes_send",
            },
            {
                id: "create_solicitudes_clientes_send",
                label: "Enviar documento a cliente",
                dependency: "view_solicitudes_clientes_send",
            },

            {
                id: "view_solicitudes_clientes_signed",
                label: "Ver documento firmado",
                dependency: "view_solicitudes_clientes_details",
            },
            {
                id: "download_solicitudes_clientes_signed",
                label: "Descargar documento firmado",
                dependency: "view_solicitudes_clientes_signed",
            },
            {
                id: "preview_solicitudes_clientes_signed",
                label: "vista previa documento firmado",
                dependency: "view_solicitudes_clientes_signed",
            },
            {
                id: "delete_solicitudes_clientes_signed",
                label: "Eliminar documento firmado",
                dependency: "view_solicitudes_clientes_signed",
            },

            { id: 'edit_solicitudes_clientes_state', label: 'Editar estado de solicitud ', dependency: 'view_solicitudes_clientes_details' },
            { id: 'edit_solicitudes_clientes_finalize', label: 'Finalizar solicitud', dependency: 'edit_solicitudes_clientes_state' },
            { id: 'edit_solicitudes_clientes_archive', label: 'Archivar solicitud', dependency: 'edit_solicitudes_clientes_state' },
        ]
    },
    //check
    solicitudes_a_cliente: {
        label: 'Vista: Solicitudes a Cliente',
        tagg: 'admin',
        permissions: [
            { id: 'view_solicitudes_a_cliente', label: 'Acceso a la vista' },
            { id: 'create_solicitudes_a_cliente', label: 'Crear solicitudes a cliente', dependency: 'view_solicitudes_a_cliente' },
        ]
    },
    tickets: {
        label: 'Vista: Tickets',
        tagg: 'admin',
        permissions: [
            { id: 'view_tickets', label: 'Acceso a la vista' },
            { id: 'delete_tickets', label: 'Eliminar solicitudes de clientes' },
            { id: 'view_tickets_details', label: 'Acceso a detalles de tickets' },
            { id: 'view_tickets_answers', label: 'Ver tickets', dependency: 'view_tickets_details' },
            { id: 'accept_tickets_answers', label: 'Aceptar tickets', dependency: 'view_tickets_details' },

            { id: 'view_tickets_attach', label: 'Ver documento adjunto', dependency: 'view_tickets_details' },
            { id: 'download_tickets_attach', label: 'Descargar documento adjunto', dependency: 'view_tickets_attach' },
            { id: 'preview_tickets_attach', label: 'vista previa documento adjunto', dependency: 'view_tickets_attach' },

            { id: 'edit_tickets_state', label: 'Editar estado de ticket ', dependency: 'view_tickets_details' },
        ]
    },
    //check
    domicilio_virtual: {
        label: 'Vista: Domicilio Virtual',
        tagg: 'admin',
        permissions: [
            { id: 'view_domicilio_virtual', label: 'Acceso a la vista' },
            { id: 'delete_domicilio_virtual', label: 'Eliminar solicitudes de clientes' },
            { id: 'view_domicilio_virtual_details', label: 'Acceso a detalles de solicitudes de clientes' },
            { id: 'view_domicilio_virtual_answers', label: 'Ver respuestas de solicitud de clientes', dependency: 'view_domicilio_virtual_details' },

            { id: 'view_domicilio_virtual_attach', label: 'Ver documento adjunto', dependency: 'view_domicilio_virtual_details' },
            { id: 'download_domicilio_virtual_attach', label: 'Descargar documento adjunto', dependency: 'view_domicilio_virtual_attach' },
            { id: 'preview_domicilio_virtual_attach', label: 'vista previa documento adjunto', dependency: 'view_domicilio_virtual_attach' },

            { id: 'view_domicilio_virtual_generated', label: 'Ver documento generado', dependency: 'view_domicilio_virtual_details' },
            { id: 'download_domicilio_virtual_generated', label: 'Descargar documento generado', dependency: 'view_domicilio_virtual_generated' },
            { id: 'preview_domicilio_virtual_generated', label: 'vista previa documento generado', dependency: 'view_domicilio_virtual_generated' },
            { id: 'regenerate_domicilio_virtual_generated', label: 'Regenerar documento', dependency: 'view_domicilio_virtual_generated' },

            { id: 'edit_domicilio_virtual_state', label: 'Editar estado de solicitud ', dependency: 'view_domicilio_virtual_details' },

        ]
    },
    //check
    rendimiento: {
        label: 'Vista: Rendimiento',
        tagg: 'admin',
        permissions: [
            { id: 'view_rendimiento', label: 'Acceso a la vista' },
            { id: 'view_rendimiento_previo', label: 'Visualizar estadisticas de semanas anteriores', dependency: 'view_rendimiento' },
            { id: 'view_rendimiento_global', label: 'Visualizar estadisticas globales', dependency: 'view_rendimiento' },
        ]
    },
    //check
    formularios_admin: {
        label: 'Vista: Formularios',
        tagg: 'admin',
        permissions: [
            { id: 'view_formularios', label: 'Acceso a la vista' },
            { id: 'create_formularios', label: 'Crear nuevos formularios', dependency: 'view_formularios' },
            { id: 'edit_formularios', label: 'Editar formularios existentes', dependency: 'view_formularios' },
            { id: 'edit_formularios_propiedades', label: 'Editar propiedades de formularios existentes', dependency: 'edit_formularios' },
            { id: 'edit_formularios_preguntas', label: 'Editar preguntas de formularios existentes', dependency: 'edit_formularios' },
            { id: 'delete_formularios', label: 'Eliminar formularios', dependency: 'view_formularios' },
        ]
    },
    //check
    plantillas: {
        label: 'Vista: Plantillas',
        tagg: 'admin',
        permissions: [
            { id: 'view_plantillas', label: 'Acceso a la vista' },
            { id: 'create_plantillas', label: 'Crear nuevas plantillas', dependency: 'view_plantillas' },
            { id: 'copy_plantillas', label: 'Copiar plantilla existente', dependency: 'create_plantillas' },
            { id: 'edit_plantillas', label: 'Editar plantillas existentes', dependency: 'view_plantillas' },
            { id: 'delete_plantillas', label: 'Eliminar plantillas', dependency: 'view_plantillas' },
        ]
    },
    configuracion_tickets: {
        label: 'Vista: Configuración de Tickets',
        tagg: 'admin',
        permissions: [
            { id: 'view_configuracion_tickets', label: 'Acceso a la vista' },
            { id: 'create_categoria_ticket', label: 'Crear categorías de tickets', dependency: 'view_configuracion_tickets' },
            { id: 'edit_categoria_ticket', label: 'Editar categorías de tickets', dependency: 'view_configuracion_tickets' },
            { id: 'delete_categoria_ticket', label: 'Eliminar categorías de tickets', dependency: 'edit_categoria_ticket' },
        ]
    },

    pagos: {
        label: 'Vista: Planes y Servicios (Pagos)',
        tagg: 'admin',
        permissions: [
            { id: 'view_pagos', label: 'Acceso a la vista' },
        ]
    },

    anuncios: {
        label: 'Vista: Anuncios',
        tagg: 'admin',
        permissions: [
            { id: 'view_anuncios', label: 'Acceso a la vista' },
            { id: 'create_anuncios', label: 'Crear anuncios web', dependency: 'view_anuncios' },
            { id: 'create_anuncios_web', label: 'Crear anuncios web', dependency: 'create_anuncios' },
            { id: 'create_anuncios_mail', label: 'Crear anuncios mail', dependency: 'create_anuncios' },
            { id: 'create_anuncios_for_all', label: 'Crear anuncios para todos los usuarios', dependency: 'create_anuncios' },
            { id: 'create_anuncios_filter', label: 'Crear anuncios para usuarios filtrados', dependency: 'create_anuncios' },
            { id: 'create_anuncios_manual', label: 'Crear anuncios enviados manualmente', dependency: 'create_anuncios' },
        ]
    },
    //check
    comprobantes: {
        label: 'Vista: Comprobantes de Pago',
        tagg: 'admin',
        permissions: [
            { id: 'view_comprobantes', label: 'Acceso a la vista' },
            { id: 'create_comprobantes', label: 'Subir comprobantes', dependency: 'view_comprobantes' },
        ]
    },

    usuarios: {
        label: 'Vista: Usuarios',
        tagg: 'admin',
        permissions: [
            { id: 'view_usuarios', label: 'Acceso a la vista' },
            { id: 'edit_usuarios', label: 'Editar Usuarios', dependency: 'view_usuarios' },
            { id: 'delete_usuarios', label: 'Eliminar Usuarios', dependency: 'view_usuarios' },
            { id: 'create_usuarios', label: 'Crear Usuarios', dependency: 'view_usuarios' },
        ]
    },
    //check
    empresas: {
        label: 'Vista: Empresas',
        tagg: 'admin',
        permissions: [
            { id: 'view_empresas', label: 'Acceso a la vista' },
            { id: 'edit_empresas', label: 'Editar Empresas', dependency: 'view_empresas' },
            { id: 'delete_empresas', label: 'Eliminar Empresas', dependency: 'view_empresas' },
            { id: 'create_empresas', label: 'Crear Empresas', dependency: 'view_empresas' },
        ]
    },

    gestor_empresas: {
        label: 'Vista: Dashboard Empresas',
        tagg: 'admin',
        permissions: [
            { id: 'view_gestor_empresas', label: 'Acceso a la vista' },
            { id: 'create_gestor_empresas', label: 'Crear empresas', dependency: 'view_gestor_empresas' },
            { id: 'edit_gestor_empresas', label: 'Editar empresas', dependency: 'view_gestor_empresas' },
            { id: 'delete_gestor_empresas', label: 'Eliminar empresas', dependency: 'view_gestor_empresas' },
            { id: 'view_empresas_permissions_list', label: 'Ver lista de permisos', dependency: 'view_gestor_empresas' },
        ]
    },
    configuracion_planes: {
        label: 'Vista: Configuración de Planes',
        tagg: 'admin',
        permissions: [
            { id: 'view_configuracion_planes', label: 'Acceso a la vista' },
            { id: 'edit_configuracion_planes', label: 'Editar planes y límites', dependency: 'view_configuracion_planes' },
        ]
    },
    //check
    gestor_roles: {
        label: 'Vista: Gestor de Roles',
        tagg: 'admin',
        permissions: [
            { id: 'view_gestor_roles', label: 'Acceso a la vista' },
            { id: 'view_gestor_roles_details', label: 'Acceso a la vista detallada', dependency: 'view_gestor_roles' },
            { id: 'create_gestor_roles', label: 'Crear nuevos roles', dependency: 'view_gestor_roles' },
            { id: 'copy_gestor_roles', label: 'Duplicar roles existentes', dependency: 'view_gestor_roles' },
            { id: 'edit_gestor_roles', label: 'Editar roles existentes', dependency: 'view_gestor_roles_details' },
            { id: 'edit_gestor_roles_by_self', label: 'Editar rol propio', dependency: 'view_gestor_roles_details' },
            { id: 'view_gestor_roles_details_admin', label: 'Acceso a la vista detallada (admin)', dependency: 'view_gestor_roles' },
            { id: 'edit_gestor_roles_admin', label: 'Editar rol existente (Admin)', dependency: 'view_gestor_roles_details' },
            { id: 'delete_gestor_roles', label: 'Eliminar roles', dependency: 'view_gestor_roles' },
        ]
    },
    gestor_notificaciones: {
        label: 'Vista: Gestor de Notificaciones',
        tagg: 'admin',
        permissions: [
            { id: 'view_gestor_notificaciones', label: 'Acceso a la vista' },
            { id: 'view_gestor_notificaciones_details', label: 'Acceso a la vista detallada' },
            { id: 'delete_gestor_notificaciones', label: 'Eliminar notificaciones' },
        ]
    },
    //check
    registro_cambios: {
        label: 'Vista: Registro de Cambios',
        tagg: 'admin',
        permissions: [
            { id: 'view_registro_cambios', label: 'Acceso a la vista' },
            { id: 'view_registro_cambios_details', label: 'Acceso a la vista detallada', dependency: 'view_registro_cambios' }
        ]
    },
    //check
    registro_ingresos: {
        label: 'Vista: Registro de Ingresos',
        tagg: 'admin',
        permissions: [{ id: 'view_registro_ingresos', label: 'Acceso a la vista' }]
    },

    // --- VISTAS TAGG: CLIENTE ---
    home: {
        label: 'Vista: home',
        tagg: 'cliente',
        permissions: [
            { id: 'view_home', label: 'Acceso a la vista' }
        ]
    },
    perfil: {
        label: 'Vista: Perfil',
        tagg: 'cliente',
        permissions: [
            { id: 'view_perfil', label: 'Acceso a la vista' }
        ]
    },

    mis_solicitudes: {
        label: 'Vista: Mis solicitudes',
        tagg: 'cliente',
        permissions: [
            { id: 'view_mis_solicitudes', label: 'Acceso a la vista' },
            { id: 'share_mis_solicitudes', label: 'Compartir solicitudes' },
            { id: 'unshare_mis_solicitudes', label: 'Dejar de compartir solicitudes' },

        ]
    },
    formularios_cliente: {
        label: 'Vista: Formularios',
        tagg: 'cliente',
        permissions: [
            { id: 'view_formularios_cliente', label: 'Acceso a la vista' }
        ]
    },
    formulario: {
        label: 'Vista: Formulario',
        tagg: 'cliente',
        permissions: [
            { id: 'view_formulario', label: 'Acceso a la vista' }
        ]
    },
    registro_empresas: {
        label: 'Vista: Registro de Empresas',
        tagg: 'admin',
        permissions: [
            {
                id: 'view_acceso_registro_empresas',
                label: 'Acceso a la vista'
            },
            {
                id: 'view_registro_ingresos_empresas',
                label: 'Ver pestaña: Registro de Ingresos',
                dependency: 'view_acceso_registro_empresas' // Sincronizado con tu ID
            },
            {
                id: 'view_registro_cambios_empresas',
                label: 'Ver pestaña: Registro de Cambios',
                dependency: 'view_acceso_registro_empresas' // Sincronizado con tu ID
            },
            {
                id: 'view_registro_cambios_details_empresas',
                label: 'Acceso a detalles de cambios (Modal)',
                dependency: 'view_acceso_registro_empresas'
            },
        ]
    },
    chatbot: {
        label: 'Vista: chatbot',
        tagg: 'admin',
        permissions: [
            { id: 'view_chatbot', label: 'Acceso a la vista' },
            { id: 'view_chatbot_envio', label: 'Envio de mensajes al chatbot', dependency: 'view_chatbot' },
            
        ]
    },
};

module.exports = { PERMISSION_GROUPS };
