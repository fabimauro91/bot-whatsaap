# Bot de WhatsApp

Este es un bot simple para WhatsApp Web utilizando la biblioteca whatsapp-web.js.

## Requisitos

- Node.js (versión 12 o superior)
- NPM (gestor de paquetes de Node.js)
- Un teléfono con WhatsApp instalado

## Instalación

1. Clona o descarga este repositorio
2. Ejecuta `npm install` para instalar las dependencias
3. Ejecuta `node index.js` para iniciar el bot

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