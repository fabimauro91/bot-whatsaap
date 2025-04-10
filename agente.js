// agente.js

const fs = require('fs');
const axios = require('axios');
const PedidosWhatsapp = require('./models/pedidos_whatsapp');

class Agente {
    constructor(whatsappClient) {

        // Guardar la referencia al cliente de WhatsApp
        this.whatsappClient = whatsappClient;

        // Inicialización de variables
        this.categorias = {
            1: 'Bisutería',
            2: 'Ropa Deportiva',
            3: 'Vaporizadores',
            4: 'Mascotas',
            5: 'Moda',
            6: 'Tecnología',
            7: 'Cocina',
            8: 'Belleza',
            9: 'Salud',
            10: 'Hogar',
            11: 'Natural Home',
            12: 'Deportes',
            13: 'Sex Shop',
            14: 'Bebé',
            15: 'Aseo',
            16: 'Bienestar',
            17: 'Camping',
            18: 'Pesca',
            19: 'Defensa Personal',
            20: 'Vehículos',
            21: 'Juguetería',
            22: 'Otros'
        };
        
        this.nombreTienda = '99envios';
        this.nombreVendedor = 'Juan Manuel';
        this.productosCache = [];
        this.conversacionCache = '';

        // Inicializar el Map para los pedidos
        this.clientesEnProcesoDePedido = new Map();
    }

    // Métodos para gestionar el estado
    setNombreTienda(nombre) {
        this.nombreTienda = nombre; 
    }

    setNombreVendedor(nombre) {
        this.nombreVendedor = nombre;
    }


    // Método auxiliar para enviar mensajes
    async enviarMensaje(message, texto) {
        try {
            if (typeof message.reply === 'function') {
                await message.reply(texto);
            } else {
                // Asegurarse de que message.from existe
                const destinatario = message.from || message;
                await this.whatsappClient.sendMessage(destinatario, texto);
            }
        } catch (error) {
            console.error('Error al enviar mensaje:', error);
            // Intentar método alternativo si el primero falla
            try {
                await this.whatsappClient.sendMessage(message.from, texto);
            } catch (secondError) {
                console.error('Error en método alternativo de envío:', secondError);
                throw secondError;
            }
        }
    }


    // Método para cargar productos desde API
    async cargarProductosDesdeAPI(usuarioSucursal) {
        try {
            console.log(`📡 Consultando productos para la sucursal ${usuarioSucursal}...`);
            const response = await axios.get(`https://api.99envios.app/api/inventarios/${usuarioSucursal}`);
            
            const productosTransformados = response.data.map(producto => {
                const categoriaId = producto.id_categoria;
                let categoriaNombre;

                if (!categoriaId || !this.categorias[categoriaId]) {
                    categoriaNombre = this.categorias[22];
                    console.log(`ℹ️ Producto "${producto.nombre_producto}" sin categoría válida. Asignando categoría "Otros"`);
                } else {
                    categoriaNombre = this.categorias[categoriaId];
                }

                return {
                    ...producto,
                    id_categoria: categoriaNombre
                };
            });

            this.productosCache = productosTransformados;
           // fs.writeFileSync('productos.json', JSON.stringify(productosTransformados, null, 2));
            return productosTransformados;
        } catch (error) {
            console.error('❌ Error al cargar productos desde la API:', error.message);
            return [];
        }
    }

    cargarProductosDesdeJSON() {
        try {
            const data = fs.readFileSync('productos.json', 'utf8');
            this.productosCache = JSON.parse(data);
            console.log('✅ Productos cargados desde el archivo JSON.');
        } catch (error) {
            console.error('❌ Error al cargar productos desde JSON:', error.message);
        }
    }

    async consultarGemini(mensaje, genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            
            const promptVendedor = `Cuando inicie una conversacion actue como un vendedor llamado ${this.nombreVendedor}, un vendedor amable y profesional de la tienda ${this.nombreTienda}.
                                  necesitamos verder estos productos: ${contextoProductos}
                                  Responde al siguiente mensaje del cliente: "${mensaje}"
                                  sí el cliente escribe alguna palabra de (necesito, quiero, me gustaria), hay que estar atento al complemento de la oracion y buscar entre los productos coincidencia de lo que requiere el cliente
                                  Mantén un tono amable, profesional y orientado a ventas.
                                  Si el cliente muestra interés en alguna caegoria, ofrece los producttos relacionados a la categoria.
                                  tener en cuenta las conversaciones anteriores: "${this.conversacionCache}"`;

            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text();
            this.conversacionCache += textoRespuesta + '\n';
            
            return textoRespuesta;
        } catch (error) {
            console.error('❌ Error al consultar Gemini:', error.message);
            return "Lo siento, en este momento no puedo procesar tu mensaje. ¿Te gustaría ver nuestro catálogo de productos?";
        }
    }

    async consultarGeminiConProductos(message, genAI) {
        try {
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const promptVendedor = `
            Contexto: Estos son los productos disponibles: ${contextoProductos}
            Mensaje del usuario: ${message.body}
            Si el usuario está preguntando por información sobre un producto específico, 
            devuelve el nombre exacto del producto como aparece en la lista.
            Si no está preguntando por un producto específico, devuelve "0".
            Solo devuelve el nombre del producto o "0", sin texto adicional.
            tener esta conversacion anterior: ${this.conversacionCache}`;

            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text().trim();

            if (textoRespuesta && textoRespuesta !== "0") {
                this.conversacionCache += textoRespuesta + '\n';
                const producto = this.productosCache.find(p => 
                    p.nombre_producto.toLowerCase() === textoRespuesta.toLowerCase()
                );

                if (producto) {
                    let mensajeProducto = `Claro que si, esta es la informacion de nuestro producto\n\n`;
                    mensajeProducto += `*🛒 Detalles del Producto*\n\n`;
                    mensajeProducto += `*Nombre:* ${producto.nombre_producto}\n`;
                    mensajeProducto += `*Descripción:* ${producto.descripcion || 'Sin descripción'}\n`;
                    mensajeProducto += `*Información adicional:* ${producto.informacion_adicional || 'Sin información adicional'}\n`;
                    mensajeProducto += `*Precio:* $${producto.precio_sugerido}\n`;
                    mensajeProducto += `*Cantidad disponible:* ${producto.cantidad || 'No especificada'}\n\n`;
                    mensajeProducto += `¿le gustaria obtenerlo?\nSi lo pide hoy, lo pagas cuando llege a su casa con nuestro servicio de contra-entrga`;

                    this.conversacionCache += mensajeProducto + '\n';
                    await this.enviarMensaje(message, mensajeProducto);
                    return true;
                }
            }
            return false;
        } catch (error) {
            console.error('Error en consultarGeminiConProductos:', error);
            throw error;
        }
    }

    async procesarSolicitudCompra(message, genAI) {
        try {
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
            // Prompt para detectar intención de compra y producto específico
            const promptVendedor = `
            Contexto: Estos son los productos disponibles: ${contextoProductos}
    
            Mensaje del usuario: ${message.body}
            
            Analiza si el mensaje indica una intención de compra (usando palabras como "comprar", "pedir", "adquirir", "quiero encargarlo", etc.) 
            y menciona un producto específico.
            Si el cliente dice necesito aun no es una compra.
            Si hay intención de compra y producto específico, devuelve el nombre exacto del producto.
            Si no hay intención de compra o no menciona un producto específico, devuelve "0".
            Solo devuelve el nombre del producto o "0", sin texto adicional.
            Tener en cuenta la conversacion anterior: ${this.conversacionCache}`;
    
            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text().trim();
    
            if (textoRespuesta && textoRespuesta !== "0") {
                // Buscar el producto en el cache
                this.conversacionCache += textoRespuesta + '\n';
                const producto = this.productosCache.find(p => 
                    p.nombre_producto.toLowerCase() === textoRespuesta.toLowerCase()
                );
    
                if (producto) {
                    // Iniciar proceso de compra
                    await this.iniciarProcesoCompra(message, producto);
                    return true; // Indica que se inició proceso de compra
                }
            }
            
            return false; // Indica que no se detectó intención de compra
        } catch (error) {
            console.error('Error en procesarSolicitudCompra:', error);
            throw error;
        }
    }
    
    // Función para manejar el proceso de compra
    async iniciarProcesoCompra(message, producto) {
        try {
            
            // Crear objeto de pedido
            const pedido = {
                producto: producto,
                estado: 'solicitando_datos',
                timestamp: Date.now(),
                codigo_sucursal: producto.id_sucursal, // Asumiendo que el producto tiene id_sucursal
                id_producto: producto.id_producto,
                nombre_producto: producto.nombre_producto,
                telefono: message.from.replace(/\D/g, ''), // Limpia el número de teléfono de caracteres no numéricos
            };
    
            // Guardar en el contexto del usuario
            this.clientesEnProcesoDePedido.set(message.from, pedido);
    
            // Enviar mensaje solicitando datos
            let mensajeSolicitud = `*🛍️ ¡Excelente elección!*\n\n`;
            mensajeSolicitud += `Has seleccionado:\n`;
            mensajeSolicitud += `*${producto.nombre_producto}*\n`;
            mensajeSolicitud += `Precio: $${producto.precio_sugerido}\n\n`;
            mensajeSolicitud += `Para completar tu pedido necesito los siguientes datos:\n\n`;
            mensajeSolicitud += `1️⃣ Por favor, envía tu nombre completo\n`; // Agregado nombre
            mensajeSolicitud += `2️⃣ Después enviarás tu correo electrónico\n`;
            mensajeSolicitud += `3️⃣ Finalmente enviarás tu dirección de entrega\n\n`;
            mensajeSolicitud += `*Recuerda que el pago es contra entrega* 💰\n`;
            mensajeSolicitud += `\nEnvía tu nombre completo para continuar.`;
            
            this.conversacionCache += mensajeSolicitud + '\n';
            await this.enviarMensaje(message, mensajeSolicitud);
        } catch (error) {
            console.error('Error al iniciar proceso de compra:', error);
            throw error;
        }
    }
    
    // Función para procesar la respuesta del cliente con sus datos
    async procesarDatosCliente(message) {
        try {
            const from = message.from || message;
            const body = message.body || message;
            const pedido = this.clientesEnProcesoDePedido.get(from);
            
            if (!pedido) return false;
    
            switch (pedido.estado) {
                case 'solicitando_datos':
                    // Guardar nombre del cliente
                    pedido.nombre_cliente = body;
                    pedido.estado = 'solicitando_correo';
                    await this.enviarMensaje(message, `*✅ Nombre registrado*\n\nAhora por favor envía tu correo electrónico.`);
                    return true;
    
                case 'solicitando_correo':
                    if (this.validarCorreo(body)) {
                        pedido.email = body;
                        pedido.estado = 'solicitando_ciudad';
                        await this.enviarMensaje(message, `*✅ Correo registrado*\n\nAhora por favor envía la ciudad de entrega`);
                    } else {
                        await this.enviarMensaje(message, '⚠️ Por favor, envía un correo electrónico válido.');
                    }
                    return true;
                
                case 'solicitando_ciudad':
                    // Guardar nombre del cliente
                    pedido.ciudad = body;
                    pedido.estado = 'solicitando_direccion';
                    await this.enviarMensaje(message, `*✅ Ciudad registrada*\n\nAhora por favor envía la direccion, incluyendo:\n- Calle/Avenida\n- Número\n- Referencias.`);
                    return true;
    
                case 'solicitando_direccion':
                    pedido.direccion = body;
                    pedido.estado = 'completado';
    
                    // Guardar en la base de datos
                    try {
                        await this.guardarPedidoEnBD(pedido);
                        
                        // Generar resumen del pedido
                        let resumenPedido = `*🎉 ¡Pedido Confirmado!*\n\n`;
                        resumenPedido += `*Producto:* ${pedido.nombre_producto}\n`;
                        resumenPedido += `*Nombre:* ${pedido.nombre_cliente}\n`;
                        resumenPedido += `*Correo:* ${pedido.email}\n`;
                        resumenPedido += `*Teléfono:* ${pedido.telefono}\n`;
                        resumenPedido += `*Dirección:* ${pedido.direccion}\n\n`;
                        resumenPedido += `*Ciudad:* ${pedido.ciudad}\n\n`;
                        resumenPedido += `*Método de pago:* Contra entrega\n\n`;
                        resumenPedido += `Nos pondremos en contacto contigo pronto para coordinar la entrega. ¡Gracias por tu compra! 🙏`;
    
                        await this.enviarMensaje(message, resumenPedido);
                    } catch (error) {
                        console.error('Error al guardar el pedido:', error);
                        await this.enviarMensaje(message, '⚠️ Lo sentimos, hubo un error al procesar tu pedido. Por favor, intenta nuevamente más tarde.');
                    }
                    
                    // Limpiar el contexto del usuario
                    this.clientesEnProcesoDePedido.delete(from);
                    return true;
            }
        } catch (error) {
            console.error('Error al procesar datos del cliente:', error);
            throw error;
        }
        return false;
    }

    async guardarPedidoEnBD(pedido) {
        try {
            // Asumiendo que tienes un modelo de Sequelize llamado PedidosWhatsapp
            const nuevoPedido = await PedidosWhatsapp.create({
                codigo_sucursal: pedido.codigo_sucursal,
                id_producto: pedido.id_producto,
                nombre_producto: pedido.nombre_producto,
                nombre_cliente: pedido.nombre_cliente,
                direccion: pedido.direccion,
                telefono: pedido.telefono,
                email: pedido.email,
                estado: 'pendiente'
            });
    
            return nuevoPedido;
        } catch (error) {
            console.error('Error al guardar en la base de datos:', error);
            throw error;
        }
    }

     // Función auxiliar para validar correo
     validarCorreo(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }
    // Método para limpiar pedidos antiguos
    limpiarPedidosAntiguos() {
        const tiempoLimite = 30 * 60 * 1000; // 30 minutos
        const ahora = Date.now();
        
        for (const [userId, pedido] of this.clientesEnProcesoDePedido.entries()) {
            if (ahora - pedido.timestamp > tiempoLimite) {
                this.clientesEnProcesoDePedido.delete(userId);
            }
        }
    }
}

// Exportar la clase
module.exports = Agente;