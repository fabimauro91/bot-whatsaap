require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Almacenamiento de instancias en memoria
const instances = new Map();

// Función para crear instancia de WhatsApp
async function createWhatsAppInstance(phoneNumber) {
    // Buscar si ya existe una instancia activa para ese número
    for (const [id, instance] of instances.entries()) {
        if (instance.phoneNumber === phoneNumber && instance.connectionStatus !== 'disconnected') {
            console.log(`Ya existe una instancia activa para ${phoneNumber}`);
            return { instanceId: id, success: true };
        }
    }

    const instanceId = uuidv4();

    try {
        const client = new Client({
            authStrategy: new LocalAuth({ 
                clientId: instanceId
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage'
                ]
            }
        });

        // Crear el objeto de instancia y guardarlo en el Map
        const instanceObj = {
            client,
            qrCode: null,
            connectionStatus: 'initializing',
            phoneNumber,
            createdAt: new Date()
        };
        instances.set(instanceId, instanceObj);

        // Evento QR
        client.on('qr', (qr) => {
            const instance = instances.get(instanceId);
            if (!instance) return;

            // Si ya está autenticado o conectado, ignorar el QR
            if (instance.connectionStatus === 'authenticated' || instance.connectionStatus === 'connected') {
                console.log('QR ignorado porque el cliente ya está autenticado.');
                return;
            }
            instance.qrCode = qr;
            instance.connectionStatus = 'qr_ready';
            instances.set(instanceId, instance);
            console.log(`QR generado para ${phoneNumber}`);
        });

        // Evento de autenticación
        client.on('authenticated', () => {
            const instance = instances.get(instanceId);
            if (!instance) return;
            instance.connectionStatus = 'authenticated';
            instance.qrCode = null; // Limpiar QR
            instances.set(instanceId, instance);
            console.log(`WhatsApp autenticado para ${phoneNumber}`);
        });

        // Evento de conexión exitosa
        client.on('ready', () => {
            const instance = instances.get(instanceId);
            if (!instance) return;
            instance.connectionStatus = 'connected';
            instance.qrCode = null; // Limpiar QR
            instances.set(instanceId, instance);
            console.log(`WhatsApp conectado para ${phoneNumber}`);
        });

        // Evento de desconexión
        client.on('disconnected', (reason) => {
            const instance = instances.get(instanceId);
            if (!instance) return;
            instance.connectionStatus = 'disconnected';
            instance.qrCode = null;
            instances.set(instanceId, instance);
            console.log(`WhatsApp desconectado: ${reason}`);
        });

        // Inicializar cliente
        await client.initialize();

        return { instanceId, success: true };

    } catch (error) {
        console.error('Error creando instancia:', error);
        throw error;
    }
}

// ENDPOINTS

// Crear nueva instancia
app.post('/api/instance/create', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({
            success: false,
            error: 'Se requiere número de teléfono'
        });
    }

    try {
        const result = await createWhatsAppInstance(phoneNumber);
        res.json({
            success: true,
            instanceId: result.instanceId,
            message: 'Instancia creada. Escanea el QR para conectar.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Obtener QR Code
app.get('/api/instance/:id/qr', (req, res) => {
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

    // Retornar QR como imagen HTML
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
                background: #f0f0f0; 
            }
            #qrcode { 
                padding: 20px; 
                background: white; 
                border-radius: 10px; 
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            .info {
                text-align: center;
                margin-bottom: 20px;
                color: #333;
            }
        </style>
    </head>
    <body>
        <div>
            <div class="info">
                <h2>Escanea el código QR con WhatsApp</h2>
                <p>Número: ${instance.phoneNumber}</p>
            </div>
            <div id="qrcode"></div>
        </div>
        <script>
            new QRCode(document.getElementById("qrcode"), {
                text: "${instance.qrCode}",
                width: 256,
                height: 256
            });
            // Auto-refresh cada 30 segundos
            setTimeout(() => {
                window.location.reload();
            }, 30000);
        </script>
    </body>
    </html>`;

    res.send(html);
});

// Verificar estado de instancia
app.get('/api/instance/:id/status', (req, res) => {
    const instance = instances.get(req.params.id);

    if (!instance) {
        return res.status(404).json({
            success: false,
            error: 'Instancia no encontrada'
        });
    }

    res.json({
        success: true,
        status: instance.connectionStatus,
        phoneNumber: instance.phoneNumber,
        createdAt: instance.createdAt
    });
});

// Enviar mensaje
app.post('/api/instance/:id/send', async (req, res) => {
    const { to, message } = req.body;
    const instance = instances.get(req.params.id);

    if (!instance) {
        return res.status(404).json({
            success: false,
            error: 'Instancia no encontrada'
        });
    }

    if (instance.connectionStatus !== 'connected' && instance.connectionStatus !== 'authenticated') {
        return res.status(400).json({
            success: false,
            error: 'WhatsApp no está conectado',
            status: instance.connectionStatus
        });
    }

    if (!to || !message) {
        return res.status(400).json({
            success: false,
            error: 'Se requieren los campos "to" y "message"'
        });
    }

    try {
        // Formatear número
        const formattedNumber = to.replace(/\D/g, '') + '@c.us';

        // Enviar mensaje
        await instance.client.sendMessage(formattedNumber, message);

        res.json({
            success: true,
            message: 'Mensaje enviado exitosamente',
            to: to,
            sentAt: new Date()
        });
    } catch (error) {
        console.error('Error enviando mensaje:', error);
        res.status(500).json({
            success: false,
            error: 'Error al enviar mensaje: ' + error.message
        });
    }
});

// Listar instancias
app.get('/api/instances', (req, res) => {
    const instanceList = Array.from(instances.entries()).map(([id, instance]) => ({
        instanceId: id,
        phoneNumber: instance.phoneNumber,
        status: instance.connectionStatus,
        createdAt: instance.createdAt
    }));

    res.json({
        success: true,
        instances: instanceList
    });
});

// Eliminar instancia
app.delete('/api/instance/:id', async (req, res) => {
    const instance = instances.get(req.params.id);

    if (!instance) {
        return res.status(404).json({
            success: false,
            error: 'Instancia no encontrada'
        });
    }

    try {
        // Cerrar cliente si existe
        if (instance.client) {
            await instance.client.destroy();
        }

        // Eliminar de memoria
        instances.delete(req.params.id);

        res.json({
            success: true,
            message: 'Instancia eliminada exitosamente'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor WhatsApp iniciado en puerto ${PORT}`);
    console.log('Endpoints disponibles:');
    console.log('POST /api/instance/create - Crear instancia');
    console.log('GET /api/instance/:id/qr - Ver QR');
    console.log('GET /api/instance/:id/status - Ver estado');
    console.log('POST /api/instance/:id/send - Enviar mensaje');
    console.log('GET /api/instances - Listar instancias');
    console.log('DELETE /api/instance/:id - Eliminar instancia');
});