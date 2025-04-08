const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Crear una instancia del cliente WhatsApp con navegador visible
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: false, // Esto hará que el navegador sea visible
        args: ['--no-sandbox']
    }
});

// Evento para generar y mostrar el código QR
client.on('qr', (qr) => {
    console.log('QR RECIBIDO, escanea con tu teléfono o usa el que se muestra en el navegador:');
    qrcode.generate(qr, { small: true });
});

// Evento cuando el cliente está listo
client.on('ready', () => {
    console.log('¡Cliente WhatsApp listo!');
});

// Mensaje de autenticación
client.on('authenticated', () => {
    console.log('Autenticación exitosa');
});

// Capturar errores de autenticación
client.on('auth_failure', (msg) => {
    console.error('Error de autenticación', msg);
});

// Evento para manejar mensajes entrantes
client.on('message', async (message) => {
    const content = message.body.toLowerCase();
    
    // Ejemplo: si alguien envía "hola", responder con un saludo
    if (content === 'hola') {
        await message.reply('¡Hola! Soy un bot de WhatsApp. ¿En qué puedo ayudarte?');
    }
    
    // Ejemplo: responder a comando de ayuda
    if (content === 'ayuda') {
        await message.reply(`Comandos disponibles:
        - hola: Para saludar
        - ayuda: Muestra esta ayuda
        - hora: Muestra la hora actual`);
    }
    
    // Ejemplo: mostrar la hora actual
    if (content === 'hora') {
        const fecha = new Date().toLocaleString('es-ES');
        await message.reply(`La hora actual es: ${fecha}`);
    }
});

// Iniciar el cliente
client.initialize();

console.log('Iniciando bot de WhatsApp con navegador visible...');
console.log('Se abrirá una ventana del navegador con el código QR...'); 