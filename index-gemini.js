require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuración de API de Google
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDJC5a882ruuCCw1tdBszrsQ2f7-LAdWNI'; // Clave API demo (limitada)
const BOT_NAME = process.env.BOT_NAME || 'GeminiBot';

// Inicializar la API de Google
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

// Crear una instancia del cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// Función para obtener respuesta de Gemini
async function consultarGemini(mensaje) {
    try {
        console.log(`📤 Enviando consulta a Gemini: "${mensaje}"`);
        
        // Para depuración: mostrar parte de la clave API (de forma segura)
        const keySuffix = GOOGLE_API_KEY.substring(GOOGLE_API_KEY.length - 4);
        console.log(`🔑 Usando clave API que termina en: ...${keySuffix}`);
        
        // Obtener el modelo (gemini-pro es el modelo de texto)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Generar respuesta
        const result = await model.generateContent(mensaje);
        const response = await result.response;
        const textoRespuesta = response.text();
        
        console.log(`📥 Respuesta de Gemini: "${textoRespuesta.substring(0, 50)}..."`);
        return textoRespuesta;
    } catch (error) {
        console.error('❌ Error al consultar Gemini:', error.message);
        if (error.message.includes('API key not valid')) {
            console.error('🔴 La clave API no es válida. Verifica que hayas copiado correctamente la clave de Google AI Studio.');
            return "Error: La clave API de Google no es válida. Por favor, verifica la configuración del bot.";
        }
        return "Lo siento, ocurrió un error al procesar tu mensaje. Inténtalo más tarde.";
    }
}

// Evento para generar y mostrar el código QR
client.on('qr', (qr) => {
    console.log('📱 QR RECIBIDO, escanea con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

// Evento cuando el cliente está listo
client.on('ready', () => {
    console.log(`🤖 ${BOT_NAME} está listo y conectado a WhatsApp!`);

/*     setTimeout(() => {
        enviarMensaje('573041207676', 'Hola, soy un bot de prueba!');
    }, 3000); */
});

// Evento de autenticación
client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
});

// Capturar errores de autenticación
client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación', msg);
});

// Evento para manejar mensajes entrantes
client.on('message', async (message) => {
    // Ignorar mensajes propios
    if (message.fromMe) return;
    
    try {
        console.log(`📩 Mensaje recibido de ${message.from}: "${message.body}"`);
        
        // Comandos específicos del bot
        const contenido = message.body.toLowerCase();
        
        // Comando para reiniciar o ayuda
        if (contenido === '/start' || contenido === '/help' || contenido === '/ayuda') {
            await message.reply(`👋 Hola! Soy ${BOT_NAME}, un asistente potenciado por Google Gemini.

🤔 Puedes preguntarme cualquier cosa y trataré de ayudarte.

⚙️ Comandos especiales:
/ayuda - Muestra este mensaje
/info - Información sobre mí`);
            return;
        }
        
        // Comando para información
        if (contenido === '/info') {
            await message.reply(`ℹ️ *Información del Bot*
🤖 Nombre: ${BOT_NAME}
🧠 Potenciado por: Google Gemini
🛠️ Desarrollado con: whatsapp-web.js

Este bot integra WhatsApp con inteligencia artificial para responder a tus preguntas.`);
            return;
        }
        
        // Notificar al usuario que estamos procesando su mensaje
        await client.sendMessage(message.from, '⏳ Procesando tu mensaje...');
        
        // Obtener respuesta de Gemini
        const respuesta = await consultarGemini(message.body);
        
        // Enviar respuesta
        await message.reply(respuesta);
        
    } catch (error) {
        console.error('❌ Error al procesar mensaje:', error);
        await message.reply('Lo siento, ocurrió un error al procesar tu mensaje.');
    }
});

// Capturar desconexiones
client.on('disconnected', (reason) => {
    console.log('❌ Cliente desconectado:', reason);
});

// Iniciar el cliente
client.initialize();


console.log(`🚀 Iniciando ${BOT_NAME} con Google Gemini...`);
console.log('⏳ Espera mientras se genera el código QR para iniciar sesión...'); 

async function enviarMensaje(numero, mensaje) {
    try {
        const numeroFormateado = numero.replace(/\D/g, '') + '@c.us'; // Formatear número
        await client.sendMessage(numeroFormateado, mensaje);
        console.log(`✅ Mensaje enviado a ${numero}: "${mensaje}"`);
    } catch (error) {
        console.error(`❌ Error al enviar mensaje a ${numero}:`, error);
    }
}

