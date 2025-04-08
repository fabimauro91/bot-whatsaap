# Bot de WhatsApp Avanzado

Este es un bot avanzado para WhatsApp Web que utiliza whatsapp-web.js con características adicionales como API REST, integración con base de datos y más.

## Características

- 🤖 Bot de WhatsApp básico
- 🌐 Servidor API REST integrado
- 💾 Integración con base de datos
- 🔐 Manejo de variables de entorno
- 📁 Estructura modular del proyecto
- 🎨 Múltiples versiones del bot (normal, visual, gemini)

## Requisitos

- Node.js (versión 12 o superior)
- NPM (gestor de paquetes de Node.js)
- MySQL/MariaDB para la base de datos
- Un teléfono con WhatsApp instalado

## Estructura del Proyecto

```
├── config/               # Configuraciones del proyecto
├── models/              # Modelos de la base de datos
├── .wwebjs_auth/        # Archivos de autenticación de WhatsApp
├── api-server.js        # Servidor API REST
├── index.js            # Bot principal
├── index-gemini.js     # Versión con integración Gemini
├── index-visual.js     # Versión con características visuales
└── sync-db.js          # Sincronización de base de datos
```

## Instalación

1. Clona este repositorio:
```bash
git clone https://github.com/fabimauro91/bot-whatsaap.git
cd bot-whatsaap
```

2. Instala las dependencias:
```bash
npm install
```

3. Crea y configura el archivo `.env` con las siguientes variables:
```env
# Configuración de la Base de Datos
DB_HOST=tu_host
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_DATABASE=tu_base_de_datos

# Configuración del

## Uso

Al iniciar el bot, se generará un código QR en la terminal. Escanea este código con tu teléfono desde WhatsApp (Configuración > WhatsApp Web).

Una vez conectado, el bot responderá a los siguientes comandos:

- `hola`: Saludo del bot
- `ayuda`: Muestra la lista de comandos disponibles
- `hora`: Muestra la hora actual

## Notas importantes

- Este bot utiliza una solución no oficial y puede violar los términos de servicio de WhatsApp
- Existe riesgo de que tu número sea baneado si se detecta uso excesivo o automatizado
- Se recomienda usar este bot solo con fines educativos o personales

## Personalización

Puedes modificar el archivo `index.js` para añadir nuevas funcionalidades o personalizar las respuestas del bot según tus necesidades. 