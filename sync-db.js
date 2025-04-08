const WhatsappInstance = require('./models/WhatsappInstance');

async function syncDatabase() {
    try {
        // Sincronizar el modelo con la base de datos
        await WhatsappInstance.sync({ alter: true });
        console.log('Base de datos sincronizada exitosamente');
        process.exit(0);
    } catch (error) {
        console.error('Error sincronizando la base de datos:', error);
        process.exit(1);
    }
}

syncDatabase(); 