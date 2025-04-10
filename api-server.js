require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const WhatsappInstance = require('./models/WhatsappInstance');
const Sucursal = require('./models/Sucursal');
const cors = require('cors');
const Agente = require('./agente.js');


// Desactivar logs de Sequelize
const { Sequelize } = require('sequelize');
Sequelize.options.logging = false;

const app = express();
app.use(express.json());

// Almacenamiento de instancias en memoria
const instances = new Map();

// Configuración de Gemini
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// Proceso de manejo de excepciones no capturadas
process.on('uncaughtException', (err) => {
    // Si es un error EBUSY de archivos bloqueados, solo mostramos un mensaje reducido
    if (err.message && err.message.includes('EBUSY')) {
        console.log('Detectado error de archivos bloqueados. El servidor continuará funcionando.');
    } else {
        console.error('ERROR NO CAPTURADO:', err);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    // Silenciar errores EBUSY de whatsapp-web.js
    if (reason && reason.message && typeof reason.message === 'string') {
        if (reason.message.includes('EBUSY') && 
            (reason.message.includes('.wwebjs_auth') || 
             reason.stack?.includes('LocalAuth.js'))) {
            // Archivos de sesión bloqueados, error conocido en Windows
            return;
        }
    }
    console.error('Promesa rechazada no manejada:', reason);
});

// Función para guardar instancia en la base de datos
async function saveInstance(instanceId, codigo_sucursal, status = 'initializing') {
    try {
        console.log(`Intentando guardar instancia en DB - Instance ID: ${instanceId}, Sucursal: ${codigo_sucursal}`);
        
        // Obtener el teléfono de la sucursal
        const sucursal = await Sucursal.findOne({
            where: { codigo_sucursal: codigo_sucursal }
        });

        const instance = await WhatsappInstance.create({
            instance_id: instanceId,
            codigo_sucursal,
            status: status,
            phone_number: sucursal.telefono // Guardamos el teléfono autorizado
        });
        console.log(`Instancia guardada exitosamente en DB - ID: ${instance.id}`);
        return instance;
    } catch (error) {
        console.error('Error guardando instancia en DB:', error);
        throw error;
    }
}

// Función para actualizar estado de instancia
async function updateInstanceStatus(instanceId, status) {
    try {
        await WhatsappInstance.update(
            { 
                status: status,
                last_connected: new Date()
            },
            { 
                where: { instance_id: instanceId }
            }
        );
    } catch (error) {
        console.error('Error actualizando estado en DB:', error);
    }
}

// Función para crear nueva instancia de WhatsApp
async function createWhatsAppInstance(codigo_sucursal) {
    if (!codigo_sucursal) {
        throw new Error('Se requiere el código de sucursal');
    }

    // Verificar si ya existe una instancia en memoria para esta sucursal
    for (const [id, inst] of instances.entries()) {
        if (inst.codigo_sucursal === codigo_sucursal) {
            console.log(`Ya existe una instancia en memoria para la sucursal ${codigo_sucursal}`);
            
            // Si la instancia existe pero está desconectada, la eliminamos para crear una nueva
            if (inst.connectionStatus === 'disconnected') {
                console.log(`La instancia existente está desconectada, eliminando para recrear...`);
                instances.delete(id);
                // Continuar con la creación de la nueva instancia
                break;
            }
            
            return {
                id: inst.dbInstance.id,
                instanceId: id,
                isNew: false
            };
        }
    }

    // Verificar si la sucursal existe
    const sucursal = await Sucursal.findOne({
        where: { codigo_sucursal: codigo_sucursal }
    });

    if (!sucursal) {
        throw new Error(`No existe una sucursal con el código ${codigo_sucursal}`);
    }

    let qrCode = null;
    let connectionStatus = 'initializing';
    let client = null;
    let instance;
    let instanceId;

    try {
        // Verificar si ya existe una instancia en la base de datos
        const existingInstance = await WhatsappInstance.findOne({
            where: { codigo_sucursal: codigo_sucursal }
        });
        

        if (existingInstance) {
            // Si la instancia está autenticada, mantener el mismo ID
            if (existingInstance.status === 'authenticated' || existingInstance.status === 'connected') {
                instanceId = existingInstance.instance_id;
                console.log(`Manteniendo instance_id existente para instancia autenticada: ${instanceId}`);
                
                // Mantener el mismo estado si estaba autenticada
                let newStatus = 'initializing';
                if (existingInstance.status === 'authenticated') {
                    newStatus = 'authenticated';
                    console.log('Preservando estado de autenticación existente');
                }
                
                // Actualizar la instancia existente con el nuevo número de teléfono de la sucursal
                await WhatsappInstance.update({
                    instance_id: instanceId,
                    status: newStatus,
                    last_connected: new Date(),
                    is_active: true,
                    phone_number: sucursal.telefono // Actualizamos el teléfono autorizado
                }, {
                    where: { id: existingInstance.id }
                });
            } else {
                // Para otros estados, generar nuevo ID
                instanceId = uuidv4();
                console.log(`Generando nuevo instance_id: ${instanceId}`);
                
                // Actualizar la instancia existente
                await WhatsappInstance.update({
                    instance_id: instanceId,
                    status: 'initializing',
                    last_connected: new Date(),
                    is_active: true,
                    phone_number: sucursal.telefono // Actualizamos el teléfono autorizado
                }, {
                    where: { id: existingInstance.id }
                });
            }
            
            instance = await WhatsappInstance.findByPk(existingInstance.id);
            console.log(`Instancia existente actualizada - ID: ${instance.id}`);
            console.log(`Teléfono autorizado actualizado: ${sucursal.telefono}`);

            // Inicializar el estado de conexión con el valor de la base de datos
            connectionStatus = instance.status;
        } else {
            // Crear nueva instancia con ID nuevo
            instanceId = uuidv4();
            console.log(`Creando nueva instancia con Instance ID: ${instanceId}`);
            instance = await saveInstance(instanceId, codigo_sucursal);
        }

        // Configuración del cliente con nuevo manejo de errores para archivos bloqueados
        client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: instanceId,
                dataPath: '.wwebjs_auth/' // Asegurarnos de que el path sea el correcto
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--enable-features=NetworkService'
                ]
            },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });

        const agente = new Agente(client);
        // Cargar productos para el agente
        await agente.cargarProductosDesdeAPI(sucursal.id_users);

        // Configurar limpieza automática de pedidos antiguos
        setInterval(() => {
            agente.limpiarPedidosAntiguos();
        }, 5 * 60 * 1000); // Cada 5 minutos


        // Sobrescribir los métodos para evitar errores en Windows
        client.logout = async function() {
            console.log('Interceptando llamada a logout para evitar errores EBUSY');
            try {
                // Cerrar el navegador en lugar de hacer logout completo
                if (this.pupPage && this.pupPage.browser()) {
                    await this.pupPage.browser().close().catch(() => {});
                }
                
                // No eliminar archivos de sesión
                
                // Actualizar estado
                connectionStatus = 'disconnected';
                
                return true;
            } catch (error) {
                console.error('Error en método logout personalizado:', error);
                return false;
            }
        };

        // También sobrescribir el método destroy para evitar que intente borrar archivos
        client.destroy = async function() {
            console.log('Interceptando llamada a destroy para evitar errores EBUSY');
            try {
                // Solo cerrar el navegador
                if (this.pupPage && this.pupPage.browser()) {
                    await this.pupPage.browser().close().catch(() => {});
                }
                return true;
            } catch (error) {
                console.error('Error en método destroy personalizado:', error);
                return false;
            }
        };

        // Manejar generación de QR
        client.on('qr', async (qr) => {
            try {
                // Solo actualizar si el QR es diferente al anterior
                if (qrCode !== qr) {
                    qrCode = qr;
                    connectionStatus = 'qr_ready';
                    await updateInstanceStatus(instanceId, 'qr_ready');
                }
            } catch (error) {
                console.error('Error actualizando QR:', error.message);
            }
        });

        // Manejar conexión exitosa
        client.on('ready', async () => {
            try {
                console.log(`\n=== Instancia ${instance.id} conectada ===`);
                
                // Si estaba autenticada, mantener ese estado
                if (instance.status === 'authenticated') {
                    console.log('Manteniendo estado anterior: authenticated');
                    connectionStatus = 'authenticated';
                    await updateInstanceStatus(instanceId, 'authenticated');
                } else {
                    connectionStatus = 'connected';
                    await updateInstanceStatus(instanceId, 'connected');
                }
                
                console.log(`✓ Estado actualizado: ${connectionStatus}`);
                console.log('Esperando estabilización de conexión...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Verificar que la conexión es realmente funcional
                console.log('Verificando estado de la conexión con WhatsApp...');
                try {
                    const state = await client.getState();
                    if (!state) {
                        console.log('⚠️ No se pudo obtener el estado, pero la conexión parece activa');
                    } else {
                        console.log(`✓ Estado de WhatsApp verificado: ${state}`);
                        console.log('✓ Bot totalmente funcional');
                    }
                } catch (stateError) {
                    console.error('Error al verificar estado:', stateError.message);
                    console.log('⚠️ Bot puede tener funcionalidad limitada');
                }
                
                console.log('✓ Conexión estabilizada\n');
            } catch (error) {
                console.error('Error en evento ready:', error.message);
            }
        });

        // Manejar desconexión
        client.on('disconnected', async (reason) => {
            try {
                console.log(`\n=== Instancia ${instance.id} desconectada ===`);
                console.log(`Razón: ${reason}`);
                
                // Actualizar estado en memoria primero
                const instanceData = instances.get(instanceId);
                if (instanceData) {
                    instanceData.connectionStatus = 'disconnected';
                    instanceData.qrCode = null;
                    instanceData.client = null;
                }

                // Actualizar estado en la base de datos
                await updateInstanceStatus(instanceId, 'disconnected');
                
                console.log('✓ Estado actualizado a disconnected');
                console.log('=== Desconexión completada ===\n');
            } catch (error) {
                console.error('Error manejando desconexión:', error);
            }
        });

        // Manejar autenticación y validar número
        client.on('authenticated', async () => {
            try {
                // Verificar si la instancia está desconectada
                const instanceData = instances.get(instanceId);
                if (instanceData?.connectionStatus === 'disconnected') {
                    // Silencio - no mostrar nada si está desconectada
                    return;
                }

                console.log(`\n=== Nueva conexión detectada en instancia ${instance.id} ===`);
                
                // Esperar a que la conexión esté completamente establecida
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Verificar nuevamente si se desconectó durante la espera
                if (instances.get(instanceId)?.connectionStatus === 'disconnected') {
                    // Silencio - no mostrar nada si está desconectada
                    return;
                }

                // Obtener información del teléfono
                const phoneInfo = await client.getState();
                
                if (!phoneInfo) {
                    throw new Error('No se pudo obtener el estado del cliente');
                }
                
                // Obtener el número conectado
                let connectedPhone = null;
                if (phoneInfo.wid && phoneInfo.wid.user) {
                    connectedPhone = phoneInfo.wid.user;
                } else if (client.info && client.info.wid) {
                    connectedPhone = client.info.wid._serialized.split('@')[0];
                } else {
                    throw new Error('No se pudo obtener el número de teléfono');
                }

                // Obtener instancia de la base de datos
                const dbInstance = await WhatsappInstance.findOne({
                    where: { instance_id: instanceId },
                    include: [{
                        model: Sucursal,
                        required: true
                    }]
                });

                if (!dbInstance) {
                    throw new Error('No se encontró la instancia en la base de datos');
                }

                // Limpiar los números para comparar
                const authorizedPhone = dbInstance.phone_number.replace(/\D/g, '');
                const cleanConnectedPhone = connectedPhone.replace(/\D/g, '').replace(/^57/, '');

                console.log('\n=== Iniciando validación de número ===');
                console.log('----------------------------------------');
                console.log(`• Instancia: ${instance.id}`);
                console.log(`• Sucursal: ${dbInstance.Sucursal.nombre_sucursal}`);
                console.log(`• Teléfono que intenta conectar (con indicativo): ${connectedPhone}`);
                console.log(`• Teléfono que intenta conectar (sin indicativo): ${cleanConnectedPhone}`);
                console.log(`• Teléfono autorizado: ${authorizedPhone}`);
                console.log('----------------------------------------');

                if (authorizedPhone !== cleanConnectedPhone) {
                    console.log('\n❌ CONEXIÓN RECHAZADA - NÚMERO NO AUTORIZADO');
                    console.log('==========================================');
                    console.error(`• Instancia: ${instance.id}`);
                    console.error(`• Sucursal: ${dbInstance.Sucursal.nombre_sucursal}`);
                    console.error(`• Teléfono conectado: ${cleanConnectedPhone} (NO AUTORIZADO)`);
                    console.error(`• Teléfono autorizado: ${authorizedPhone}`);
                    console.log('==========================================');
                    
                    await updateInstanceStatus(instanceId, 'unauthorized_number');
                    console.log('\n→ Iniciando desconexión de número no autorizado...');
                    
                    try {
                        // Solo cerrar el navegador, sin intentar borrar archivos de sesión
                        if (client.pupPage) {
                            const browser = client.pupPage.browser();
                            if (browser) {
                                await browser.close().catch(err => console.error('Error al cerrar navegador:', err.message));
                                console.log('✓ Navegador cerrado exitosamente');
                            }
                        }
                        
                        console.log('✓ Sesión finalizada');
                        
                        // Actualizar estado para que la próxima vez se cree una instancia nueva
                        const instanceData = instances.get(instanceId);
                        if (instanceData) {
                            instanceData.connectionStatus = 'disconnected';
                            instanceData.qrCode = null;
                            instanceData.client = null;
                        }
                    } catch (error) {
                        console.error('Error al intentar desconectar:', error.message);
                    }
                    
                    console.log('\n=== Acceso denegado - Esperando nuevo intento ===\n');
                    return;
                }

                console.log('\n✓ CONEXIÓN ACEPTADA - NÚMERO AUTORIZADO');
                console.log('==========================================');
                console.log(`✓ Número verificado correctamente: ${cleanConnectedPhone}`);
                console.log(`✓ Sucursal: ${dbInstance.Sucursal.nombre_sucursal}`);
                console.log('==========================================');

                connectionStatus = 'authenticated';
                await updateInstanceStatus(instanceId, 'authenticated');
                console.log('\n✓ Estado actualizado a: authenticated');
                console.log('=== Conexión establecida correctamente ===\n');
            } catch (error) {
                console.error('\n❌ Error en proceso de validación:', error.message);
                await updateInstanceStatus(instanceId, 'error');
                
                try {
                    if (client) {
                        if (client.pupPage) {
                            await client.pupPage.browser().close().catch(err => {
                                console.error('Error al cerrar navegador:', err.message);
                            });
                            console.log('✓ Navegador cerrado');
                        }
                        
                        // No intentamos hacer logout para evitar errores EBUSY
                        
                        // Actualizar estado en memoria
                        const instanceData = instances.get(instanceId);
                        if (instanceData) {
                            instanceData.connectionStatus = 'error';
                            instanceData.qrCode = null;
                            instanceData.client = null;
                        }
                    }
                } catch (cleanupError) {
                    console.error('Error durante la limpieza:', cleanupError.message);
                }
                
                console.error('=== Validación fallida ===\n');
            }
        });

        // Manejar mensajes con Gemini
        client.on('message', async (message) => {
            if (message.fromMe) return;

            // Verificar si el mensaje viene de un grupo 
            if (message. from . include ( '@g.us' )) {
                console . log ( 'Mensaje de grupo ignorado' );
                devolver ;
            
            }
            console.log(`Mensaje recibido en instancia ${instance.id} de ${message.from}: ${message.body}`);
            try {
                // Primero verificar si está en proceso de pedido
                if (await agente.procesarDatosCliente(message)) {
                    return; // Si está en proceso de pedido, no continuar con otras funciones
                }
                // Verificar si es una solicitud de compra
                const esCompra = await agente.procesarSolicitudCompra(message, genAI);
                if (esCompra) {
                    return; // Si se inició proceso de compra, no continuar
                }
                // Verificar si es una consulta sobre producto
                const esConsultaProducto = await agente.consultarGeminiConProductos(message, genAI);
                if (esConsultaProducto) {
                    return; // Si se mostró información de producto, no continuar
                }
                // Si no es nada de lo anterior, proceder con la consulta general
                const respuestaIA = await agente.consultarGemini(message, genAI);
                await client.sendMessage(message.from, respuestaIA);
                
            //         // Primero intentar procesar como consulta de producto
            //    const productoEncontrado = await agente.consultarGeminiConProductos(message, genAI);
            //    if (!productoEncontrado) {
            //     // Si no es consulta de producto, procesar como mensaje general
            //     const respuesta = await agente.consultarGemini(message.body, genAI);
            //     await message.reply(respuesta);
            //     }
                console.log(`Respuesta enviada en instancia ${instance.id}`);
            } catch (error) {
                console.error(`Error procesando mensaje en instancia ${instance.id}:`, error);
                await message.reply('Lo siento, hubo un error al procesar tu mensaje.');
            }
        });

        // Detectar si se pierde conexión con el servidor de WhatsApp
        client.on('change_state', async (state) => {
            console.log(`Estado de conexión cambiado a: ${state}`);
            
            if (state === 'UNPAIRED' || state === 'CONNECTED') {
                return; // Estados normales, no hacemos nada especial
            }
            
            if (state === 'TIMEOUT' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
                console.log('Detectada pérdida de conexión con los servidores de WhatsApp');
                
                // Solo registrar el evento sin intentar reiniciar con resetState
                if (connectionStatus !== 'disconnected') {
                    console.log('Se recomienda reiniciar manualmente el servidor si persisten problemas de conexión');
                    connectionStatus = 'unstable'; // Marcar como inestable sin desconectar
                }
            }
        });

        // Inicializar cliente
        await client.initialize();

        // Verificación adicional: asegurar que los eventos están correctamente configurados
        // Verificar y reconfigurar manejador de mensajes
        if (!client.listenerCount('message')) {
            console.log('⚠️ Reconfigurando manejador de mensajes...');
            
            // Reconfigurar el evento de mensajes
            client.on('message', async (message) => {
                if (message.fromMe) return;
                
                console.log(`Mensaje recibido en instancia ${instance.id} de ${message.from}: ${message.body}`);
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await model.generateContent(message.body);
                    const response = await result.response;
                    await message.reply(response.text());
                    console.log(`Respuesta enviada en instancia ${instance.id}`);
                } catch (error) {
                    console.error(`Error procesando mensaje en instancia ${instance.id}:`, error);
                    await message.reply('Lo siento, hubo un error al procesar tu mensaje.');
                }
            });
            console.log('✓ Manejador de mensajes reconfigurado correctamente');
        }
        
        // Verificar si el evento authenticated está configurado
        if (!client.listenerCount('authenticated')) {
            console.log('⚠️ Reconfigurando manejador de autenticación...');
            // Reconfigurar evento de autenticación para validar número
            client.on('authenticated', async () => {
                try {
                    console.log(`\n=== Verificando sesión autenticada para instancia ${instance.id} ===`);
                    // Verificar información del teléfono
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    const phoneInfo = await client.getState();
                    console.log(`✓ Sesión autenticada verificada: ${phoneInfo ? 'Activa' : 'No disponible'}`);
                    
                    if (phoneInfo) {
                        console.log(`✓ Estado de WhatsApp: ${phoneInfo}`);
                        console.log('✓ Bot preparado para recibir mensajes');
                    } else {
                        console.log('⚠️ No se pudo obtener estado completo');
                    }
                } catch (error) {
                    console.error('Error verificando autenticación:', error.message);
                }
            });
            console.log('✓ Manejador de autenticación reconfigurado');
        }
        
        // Verificar si el evento disconnected está configurado
        if (!client.listenerCount('disconnected')) {
            console.log('⚠️ Reconfigurando manejador de desconexión...');
            client.on('disconnected', async (reason) => {
                try {
                    console.log(`\n=== Instancia ${instance.id} desconectada ===`);
                    console.log(`Razón: ${reason}`);
                    
                    // Actualizar estado en memoria primero
                    const instanceData = instances.get(instanceId);
                    if (instanceData) {
                        instanceData.connectionStatus = 'disconnected';
                        instanceData.qrCode = null;
                        instanceData.client = null;
                    }

                    // Actualizar estado en la base de datos
                    await updateInstanceStatus(instanceId, 'disconnected');
                    
                    console.log('✓ Estado actualizado a disconnected');
                    console.log('=== Desconexión completada ===\n');
                } catch (error) {
                    console.error('Error manejando desconexión:', error);
                }
            });
            console.log('✓ Manejador de desconexión reconfigurado');
        }

        // Verificar conexión y forzar reconexión si es necesario
        console.log('Realizando verificación de conexión activa...');
        try {
            // Esperar a que se estabilice
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Intentar obtener el estado
            const state = await client.getState();
            console.log(`Estado actual: ${state || 'desconocido'}`);

            // Simplemente verificar si está conectado sin intentar reconexión
            let isConnected = state === 'CONNECTED';

            if (isConnected) {
                console.log('✓ Conexión verificada - Bot completamente funcional');
            } else {
                console.log('⚠️ No se detectó estado CONNECTED, pero la conexión podría seguir activa');
            }
            
            // Actualizar el estado en memoria
            connectionStatus = isConnected ? 'authenticated' : 'qr_ready';
            await updateInstanceStatus(instanceId, connectionStatus);
            console.log(`Estado actualizado a: ${connectionStatus}`);
        } catch (error) {
            console.error('Error en verificación de conexión:', error.message);
        }

        // Guardar instancia en memoria con información adicional
        instances.set(instanceId, {
            client,
            qrCode,
            connectionStatus,
            createdAt: new Date(),
            codigo_sucursal: codigo_sucursal,
            dbInstance: instance,
            agente: agente  // Agregar el agente a la instancia
        });

        return {
            id: instance.id,
            instanceId: instanceId,
            isNew: !existingInstance
        };
    } catch (error) {
        console.error(`Error creando/actualizando instancia:`, error);
        await updateInstanceStatus(instanceId, 'error');
        throw error;
    }
}

// Función para cargar instancias existentes desde la base de datos
async function loadExistingInstances() {
    console.log('\n=== Iniciando carga de instancias existentes ===');
    try {
        // Buscar instancias activas
        const existingInstances = await WhatsappInstance.findAll({
            where: { is_active: true },
            include: [{ model: Sucursal }]
        });

        console.log(`Se encontraron ${existingInstances.length} instancias activas en la base de datos.`);

        for (const instance of existingInstances) {
            console.log(`\n-> Procesando instancia ID: ${instance.id}`);
            console.log(`   Sucursal: ${instance.codigo_sucursal}`);
            console.log(`   Estado: ${instance.status}`);

            try {
                // Verificar si la sucursal existe
                const sucursal = await Sucursal.findOne({
                    where: { codigo_sucursal: instance.codigo_sucursal }
                });

                if (!sucursal) {
                    console.log(`   ❌ Sucursal ${instance.codigo_sucursal} no encontrada en la base de datos`);
                    continue;
                }

               

                console.log(`   ✓ Sucursal verificada: ${sucursal.codigo_sucursal} - ${sucursal.nombre_sucursal}`);

                // Solo intentar reconectar si estaba autenticada
                if (instance.status === 'authenticated') {
                    console.log(`   Iniciando reconexión de sesión autenticada...`);
                    
                    // Usar el instance_id existente para mantener la sesión
                    const instanceId = instance.instance_id;
                    console.log(`Intentando reconectar instancia con ID existente: ${instanceId}`);
                    
                    // Crear instancia de WhatsApp con el ID existente
                    const client = new Client({
                        authStrategy: new LocalAuth({ 
                            clientId: instanceId
                        }),
                        puppeteer: {
                            headless: true,
                            args: [
                                '--no-sandbox',
                                '--disable-setuid-sandbox',
                                '--disable-dev-shm-usage',
                                '--disable-accelerated-2d-canvas',
                                '--no-first-run',
                                '--disable-gpu',
                                '--disable-extensions',
                                '--disable-default-apps',
                                '--enable-features=NetworkService'
                            ]
                        },
                        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    });

                     // Crear y configurar el agente
                    const agente = new Agente(client);
                    await agente.cargarProductosDesdeAPI(sucursal.id_users);
                     // Configurar limpieza automática de pedidos antiguos
                    setInterval(() => {
                        agente.limpiarPedidosAntiguos();
                    }, 5 * 60 * 1000); // Cada 5 minutos

                    // Sobrescribir los métodos para evitar errores en Windows
                    client.logout = async function() {
                        console.log('Interceptando llamada a logout para evitar errores EBUSY');
                        try {
                            if (this.pupPage && this.pupPage.browser()) {
                                await this.pupPage.browser().close().catch(() => {});
                            }
                            return true;
                        } catch (error) {
                            console.error('Error en método logout personalizado:', error);
                            return false;
                        }
                    };

                    client.destroy = async function() {
                        console.log('Interceptando llamada a destroy para evitar errores EBUSY');
                        try {
                            if (this.pupPage && this.pupPage.browser()) {
                                await this.pupPage.browser().close().catch(() => {});
                            }
                            return true;
                        } catch (error) {
                            console.error('Error en método destroy personalizado:', error);
                            return false;
                        }
                    };

                    // Configurar eventos de cliente (simplificado para la reconexión)
                    let qrCode = null;
                    let connectionStatus = instance.status || 'initializing';

                    client.on('qr', async (qr) => {
                        try {
                            if (qrCode !== qr) {
                                qrCode = qr;
                                connectionStatus = 'qr_ready';
                                await updateInstanceStatus(instanceId, 'qr_ready');
                            }
                        } catch (error) {
                            console.error('Error actualizando QR:', error.message);
                        }
                    });

                    client.on('ready', async () => {
                        try {
                            console.log(`\n=== Instancia ${instance.id} conectada ===`);
                            
                            // Si estaba autenticada, mantener ese estado
                            if (instance.status === 'authenticated') {
                                console.log('Manteniendo estado anterior: authenticated');
                                connectionStatus = 'authenticated';
                                await updateInstanceStatus(instanceId, 'authenticated');
                            } else {
                                connectionStatus = 'connected';
                                await updateInstanceStatus(instanceId, 'connected');
                            }
                            
                            console.log(`✓ Estado actualizado: ${connectionStatus}`);
                            console.log('Esperando estabilización de conexión...');
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            
                            // Verificar que la conexión es realmente funcional
                            console.log('Verificando estado de la conexión con WhatsApp...');
                            try {
                                const state = await client.getState();
                                if (!state) {
                                    console.log('⚠️ No se pudo obtener el estado, pero la conexión parece activa');
                                } else {
                                    console.log(`✓ Estado de WhatsApp verificado: ${state}`);
                                    console.log('✓ Bot totalmente funcional');
                                }
                            } catch (stateError) {
                                console.error('Error al verificar estado:', stateError.message);
                                console.log('⚠️ Bot puede tener funcionalidad limitada');
                            }
                            
                            console.log('✓ Conexión estabilizada\n');
                        } catch (error) {
                            console.error('Error en evento ready:', error.message);
                        }
                    });

                    // Detectar si se pierde conexión con el servidor de WhatsApp
                    client.on('change_state', async (state) => {
                        console.log(`Estado de conexión cambiado a: ${state}`);
                        
                        if (state === 'UNPAIRED' || state === 'CONNECTED') {
                            return; // Estados normales, no hacemos nada especial
                        }
                        
                        if (state === 'TIMEOUT' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
                            console.log('Detectada pérdida de conexión con los servidores de WhatsApp');
                            
                            // Solo registrar el evento sin intentar reiniciar con resetState
                            if (connectionStatus !== 'disconnected') {
                                console.log('Se recomienda reiniciar manualmente el servidor si persisten problemas de conexión');
                                connectionStatus = 'unstable'; // Marcar como inestable sin desconectar
                            }
                        }
                    });

                    // Inicializar cliente
                    await client.initialize();

                    // Verificación adicional: asegurar que los eventos están correctamente configurados
                    // Verificar y reconfigurar manejador de mensajes
                    if (!client.listenerCount('message')) {
                        console.log('⚠️ Reconfigurando manejador de mensajes...');
                        
                        // Reconfigurar el evento de mensajes
                        client.on('message', async (message) => {
                            if (message.fromMe) return;
                            
                            console.log(`Mensaje recibido en instancia ${instance.id} de ${message.from}: ${message.body}`);
                            try {
                                // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                                // const result = await model.generateContent(message.body);
                                // const response = await result.response;
                                // await message.reply(response.text());
                                // const productoEncontrado = await agente.consultarGeminiConProductos(message, genAI);
                        
                                // if (!productoEncontrado) {
                                //     const respuesta = await agente.consultarGemini(message.body, genAI);
                                //     await message.reply(respuesta);
                                // }

                                 // Primero verificar si está en proceso de pedido
                                if (await agente.procesarDatosCliente(message)) {
                                    return; // Si está en proceso de pedido, no continuar con otras funciones
                                }
                                // Verificar si es una solicitud de compra
                                const esCompra = await agente.procesarSolicitudCompra(message, genAI);
                                if (esCompra) {
                                    return; // Si se inició proceso de compra, no continuar
                                }
                                // Verificar si es una consulta sobre producto
                                const esConsultaProducto = await agente.consultarGeminiConProductos(message, genAI);
                                if (esConsultaProducto) {
                                    return; // Si se mostró información de producto, no continuar
                                }
                                // Si no es nada de lo anterior, proceder con la consulta general
                                const respuestaIA = await agente.consultarGemini(message, genAI);
                                await client.sendMessage(message.from, respuestaIA);

                                console.log(`Respuesta enviada en instancia ${instance.id}`);
                            } catch (error) {
                                console.error(`Error procesando mensaje en instancia ${instance.id}:`, error);
                                await message.reply('Lo siento, hubo un error al procesar tu mensaje.');
                            }
                        });
                        console.log('✓ Manejador de mensajes reconfigurado correctamente');
                    }
                    
                    // Verificar si el evento authenticated está configurado
                    if (!client.listenerCount('authenticated')) {
                        console.log('⚠️ Reconfigurando manejador de autenticación...');
                        // Reconfigurar evento de autenticación para validar número
                        client.on('authenticated', async () => {
                            try {
                                console.log(`\n=== Verificando sesión autenticada para instancia ${instance.id} ===`);
                                // Verificar información del teléfono
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                const phoneInfo = await client.getState();
                                console.log(`✓ Sesión autenticada verificada: ${phoneInfo ? 'Activa' : 'No disponible'}`);
                                
                                if (phoneInfo) {
                                    console.log(`✓ Estado de WhatsApp: ${phoneInfo}`);
                                    console.log('✓ Bot preparado para recibir mensajes');
                                } else {
                                    console.log('⚠️ No se pudo obtener estado completo');
                                }
                            } catch (error) {
                                console.error('Error verificando autenticación:', error.message);
                            }
                        });
                        console.log('✓ Manejador de autenticación reconfigurado');
                    }
                    
                    // Verificar si el evento disconnected está configurado
                    if (!client.listenerCount('disconnected')) {
                        console.log('⚠️ Reconfigurando manejador de desconexión...');
                        client.on('disconnected', async (reason) => {
                            try {
                                console.log(`\n=== Instancia ${instance.id} desconectada ===`);
                                console.log(`Razón: ${reason}`);
                                
                                // Actualizar estado en memoria primero
                                const instanceData = instances.get(instanceId);
                                if (instanceData) {
                                    instanceData.connectionStatus = 'disconnected';
                                    instanceData.qrCode = null;
                                    instanceData.client = null;
                                }

                                // Actualizar estado en la base de datos
                                await updateInstanceStatus(instanceId, 'disconnected');
                                
                                console.log('✓ Estado actualizado a disconnected');
                                console.log('=== Desconexión completada ===\n');
                            } catch (error) {
                                console.error('Error manejando desconexión:', error);
                            }
                        });
                        console.log('✓ Manejador de desconexión reconfigurado');
                    }

                    // Verificar conexión y forzar reconexión si es necesario
                    console.log('Realizando verificación de conexión activa...');
                    try {
                        // Esperar a que se estabilice
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        
                        // Intentar obtener el estado
                        const state = await client.getState();
                        console.log(`Estado actual: ${state || 'desconocido'}`);

                        // Simplemente verificar si está conectado sin intentar reconexión
                        let isConnected = state === 'CONNECTED';

                        if (isConnected) {
                            console.log('✓ Conexión verificada - Bot completamente funcional');
                        } else {
                            console.log('⚠️ No se detectó estado CONNECTED, pero la conexión podría seguir activa');
                        }
                        
                        // Actualizar el estado en memoria
                        connectionStatus = isConnected ? 'authenticated' : 'qr_ready';
                        await updateInstanceStatus(instanceId, connectionStatus);
                        console.log(`Estado actualizado a: ${connectionStatus}`);
                    } catch (error) {
                        console.error('Error en verificación de conexión:', error.message);
                    }

                    // Guardar instancia en memoria con información adicional
                    instances.set(instanceId, {
                        client,
                        qrCode,
                        connectionStatus,
                        createdAt: new Date(),
                        codigo_sucursal: instance.codigo_sucursal,
                        dbInstance: instance,
                        agente: agente  // Agregar el agente a la instancia
                    });
                    
                    console.log(`   ✓ Reconexión iniciada exitosamente`);
                } else {
                    console.log(`   Instancia en estado ${instance.status}, se requiere nuevo QR...`);
                    
                    // No intentar reconectar, simplemente crear nueva instancia
                    await createWhatsAppInstance(instance.codigo_sucursal);
                    console.log(`   ✓ Instancia reiniciada, esperando nuevo escaneo de QR`);
                    continue;
                }
            } catch (error) {
                console.error(`   ❌ Error al reconectar instancia ${instance.id}:`, error);
            }
        }

        console.log('\n=== Carga de instancias completada ===\n');
    } catch (error) {
        console.error('Error al cargar instancias existentes:', error);
    }
}

// Endpoint para crear/actualizar instancia
app.post('/api/instance/create/:codigo_sucursal', async (req, res) => {
    console.log('Recibida solicitud para crear/actualizar instancia');
    const codigo_sucursal = req.params.codigo_sucursal;

    if (!codigo_sucursal) {
        return res.status(400).json({
            success: false,
            error: 'Se requiere el código de sucursal'
        });
    }

    try {
        // Verificar si la sucursal existe
        const sucursal = await Sucursal.findOne({
            where: { codigo_sucursal: codigo_sucursal }
        });

        if (!sucursal) {
            return res.status(404).json({
                success: false,
                error: `No existe una sucursal con el código ${codigo_sucursal}`
            });
        }

        // Verificar si hay una instancia existente para esta sucursal en memoria
        let existingInstanceId = null;
        for (const [id, inst] of instances.entries()) {
            if (inst.codigo_sucursal === codigo_sucursal) {
                existingInstanceId = id;
                
                // Si la instancia está desconectada, eliminarla
                if (inst.connectionStatus === 'disconnected') {
                    console.log(`Eliminando instancia desconectada: ${id}`);
                    instances.delete(id);
                    existingInstanceId = null;
                }
                
                break;
            }
        }

        // Si aún existe una instancia activa, devolver esa
        if (existingInstanceId) {
            const inst = instances.get(existingInstanceId);
            console.log(`Usando instancia existente: ${existingInstanceId}`);
            
            return res.json({
                success: true,
                instanceId: existingInstanceId,
                message: 'Instance already active',
                isNew: false,
                sucursal: {
                    codigo: sucursal.codigo_sucursal,
                    nombre: sucursal.nombre_sucursal,
                    telefono: sucursal.telefono
                }
            });
        }

        // Crear nueva instancia
        const result = await createWhatsAppInstance(codigo_sucursal);
        console.log(`Nueva instancia creada con ID: ${result.instanceId}`);
        
        res.json({
            success: true,
            instanceId: result.instanceId,
            message: 'Instance created successfully',
            isNew: true,
            sucursal: {
                codigo: sucursal.codigo_sucursal,
                nombre: sucursal.nombre_sucursal,
                telefono: sucursal.telefono
            }
        });
    } catch (error) {
        console.error('Error en endpoint create:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para obtener QR
app.get('/api/instance/:id/qr', async (req, res) => {
    try {
        const instance = instances.get(req.params.id);
        
        if (!instance) {
            return res.status(404).json({
                success: false,
                error: 'Instancia no encontrada'
            });
        }

        if (!instance.qrCode) {
            return res.status(400).json({
                success: false,
                error: 'QR no disponible'
            });
        }

        // HTML simple que solo muestra el QR
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp QR</title>
            <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
            <style>
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #f0f0f0;
                }
                #qrcode {
                    padding: 20px;
                    background: white;
                    border-radius: 10px;
                }
            </style>
        </head>
        <body>
            <div id="qrcode"></div>
            <script>
                new QRCode(document.getElementById("qrcode"), {
                    text: "${instance.qrCode}",
                    width: 256,
                    height: 256
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error al generar QR:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// Endpoint para verificar estado
app.get('/api/instance/:id/status', (req, res) => {
    const instance = instances.get(req.params.id);
    if (!instance) {
        return res.status(404).json({
            success: false,
            error: 'Instance not found'
        });
    }

    res.json({
        success: true,
        status: instance.connectionStatus
    });
});

// Endpoint para enviar mensaje
app.post('/api/instance/:id/send', async (req, res) => {
    const { number, message } = req.body;
    const instance = instances.get(req.params.id);

    if (!instance) {
        return res.status(404).json({
            success: false,
            error: 'Instance not found'
        });
    }

    try {
        const formattedNumber = number.replace(/\D/g, '') + '@c.us';
        await instance.client.sendMessage(formattedNumber, message);
        res.json({
            success: true,
            message: 'Message sent successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint para actualizar productos de una instancia
app.post('/api/instance/:id/update-products', async (req, res) => {
    try {
        const instance = instances.get(req.params.id);
        
        if (!instance) {
            return res.status(404).json({
                success: false,
                error: 'Instancia no encontrada'
            });
        }

        await instance.agente.cargarProductosDesdeAPI(instance.codigo_sucursal);
        
        res.json({
            success: true,
            message: 'Productos actualizados correctamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log('Esperando solicitudes...');
    loadExistingInstances();
}); 