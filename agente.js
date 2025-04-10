// agente.js

const fs = require('fs');
const axios = require('axios');

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
                await this.whatsappClient.sendMessage(message.from, texto);
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
            
            const promptVendedor = `Actúa como un vendedor llamado ${this.nombreVendedor}, un vendedor amable y profesional de la tienda ${this.nombreTienda}.
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
            console.log(`Analizando intención de compra en mensaje: "${message.body}"`);
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                generationConfig: {
                    temperature: 0.2,  // Temperatura baja para respuestas más precisas
                }
            });
    
            // Prompt mejorado para detectar intención de compra y producto específico
            const promptVendedor = `
            Objetivo: Detectar si el usuario está expresando intención de comprar un producto.
            
            Contexto de la conversación previa:
            ${this.conversacionCache}
            
            Mensaje del usuario: "${message.body}"
            
            Analiza si el mensaje indica una intención de compra. Considera expresiones como:
            - Afirmaciones directas: "quiero comprarlo", "me lo llevo"
            - Preguntas sobre compra: "¿cómo puedo comprarlo?", "¿cómo lo adquiero?"
            - Respuestas afirmativas: "sí", "ok", "está bien" (especialmente si antes se mencionó si quiere obtener el producto)
            - Interés explícito: "me interesa", "lo necesito"
            
            Si detectas intención de compra, busca en el contexto de la conversación cuál fue el último producto mencionado.
            
            Devuelve SOLO el nombre exacto del producto si hay intención de compra.
            Devuelve "0" si no hay clara intención de compra.

            Responde ÚNICAMENTE con el nombre del producto o "0". No incluyas explicaciones ni texto adicional.`;
    
            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text().trim();
            
            console.log(`Respuesta del análisis de intención de compra: "${textoRespuesta}"`);
    
            if (textoRespuesta && textoRespuesta !== "0") {
                // Buscar el producto en el cache
                this.conversacionCache += `[Intención de compra detectada para: ${textoRespuesta}]\n`;
                let producto = null;
                
                // Intentar encontrar el producto exacto
                producto = this.productosCache.find(p => 
                    p.nombre_producto.toLowerCase() === textoRespuesta.toLowerCase()
                );
                
                // Si no encuentra el producto exacto, buscar por coincidencia parcial
                if (!producto) {
                    console.log("Buscando producto por coincidencia parcial...");
                    for (const p of this.productosCache) {
                        if (textoRespuesta.toLowerCase().includes(p.nombre_producto.toLowerCase()) ||
                            p.nombre_producto.toLowerCase().includes(textoRespuesta.toLowerCase())) {
                            producto = p;
                            console.log(`Producto encontrado por coincidencia parcial: ${p.nombre_producto}`);
                            break;
                        }
                    }
                }
                
                // Si todavía no encuentra producto, buscar el último mencionado en la conversación
                if (!producto) {
                    console.log("Buscando último producto mencionado en la conversación...");
                    for (const p of this.productosCache) {
                        if (this.conversacionCache.includes(p.nombre_producto)) {
                            producto = p;
                            console.log(`Último producto mencionado: ${p.nombre_producto}`);
                            // Seguimos buscando para encontrar el más reciente
                        }
                    }
                }
    
                if (producto) {
                    console.log(`✓ Iniciando proceso de compra para: ${producto.nombre_producto}`);
                    // Iniciar proceso de compra
                    await this.iniciarProcesoCompra(message, producto);
                    return true; // Indica que se inició proceso de compra
                } else {
                    console.log("✗ No se encontró el producto para iniciar la compra");
                }
            } else {
                console.log("✗ No se detectó intención de compra");
            }
            
            return false; // Indica que no se detectó intención de compra
        } catch (error) {
            console.error('Error en procesarSolicitudCompra:', error);
            if (error.message && error.message.includes('429')) {
                console.log('Error de cuota excedida en Gemini, usando método alternativo...');
                
                // Método alternativo básico
                const mensajeMin = message.body.toLowerCase();
                const intencionesCompra = [
                    "comprar", "adquirir", "me interesa", "lo quiero", "obtener", 
                    "si", "ok", "está bien", "claro", "por supuesto"
                ];
                
                // Si hay alguna palabra de intención de compra
                if (intencionesCompra.some(palabra => mensajeMin.includes(palabra))) {
                    // Buscar último producto en conversación
                    for (const p of this.productosCache) {
                        if (this.conversacionCache.includes(p.nombre_producto)) {
                            console.log(`Detectada posible intención de compra para: ${p.nombre_producto}`);
                            await this.iniciarProcesoCompra(message, p);
                            return true;
                        }
                    }
                }
            }
            
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
                timestamp: Date.now()
            };
    
            // Guardar en el contexto del usuario
            this.clientesEnProcesoDePedido.set(message.from, pedido);
    
            // Enviar mensaje solicitando datos
            let mensajeSolicitud = `*🛍️ ¡Excelente elección!*\n\n`;
            mensajeSolicitud += `Has seleccionado:\n`;
            mensajeSolicitud += `*${producto.nombre_producto}*\n`;
            mensajeSolicitud += `Precio: $${producto.precio_sugerido}\n\n`;
            mensajeSolicitud += `Para finalizar tu compra, necesito algunos datos:\n\n`;
            mensajeSolicitud += `1️⃣ Tu correo electrónico\n`;
            mensajeSolicitud += `2️⃣ Tu dirección de entrega\n\n`;
            mensajeSolicitud += `*Responde primero con tu correo electrónico*, luego te pediré la dirección.\n\n`;
            mensajeSolicitud += `📌 También puedes:\n`;
            mensajeSolicitud += `3️⃣ Escribir "otro producto" para buscar un producto diferente\n`;
            mensajeSolicitud += `4️⃣ Escribir "cancelar" para cancelar la compra\n`;
    
            await this.enviarMensaje(message, mensajeSolicitud);
            
            return true;
        } catch (error) {
            console.error('Error en iniciarProcesoCompra:', error);
            await this.enviarMensaje(message, 'Lo siento, ocurrió un error al procesar tu pedido. Por favor, intenta nuevamente.');
            return false;
        }
    }
    
    // Función para procesar la respuesta del cliente con sus datos
    async procesarDatosCliente(message) {
        try {
            // Verificar si el usuario tiene un pedido en proceso
            const pedido = this.clientesEnProcesoDePedido.get(message.from);
            if (!pedido) {
                return false; // No hay pedido en proceso para este usuario
            }
            
            const mensajeUsuario = message.body.trim();
            
            // Verificar comandos especiales
            const mensajeLower = mensajeUsuario.toLowerCase();
            
            // Opción para buscar otro producto
            if (mensajeLower === "3" || mensajeLower === "otro producto" || mensajeLower.includes("otro producto")) {
                // Eliminar el pedido actual
                this.clientesEnProcesoDePedido.delete(message.from);
                
                await this.enviarMensaje(message, "¿Qué otro producto te gustaría ver? Puedes decirme la categoría o el nombre del producto que buscas.");
                
                // Añadir al contexto para recordar que el usuario estaba comprando
                this.conversacionCache += "[Usuario solicitó ver otros productos]\n";
                
                return true; // Indica que se procesó el mensaje
            }
            
            // Opción para cancelar
            if (mensajeLower === "4" || mensajeLower === "cancelar" || mensajeLower.includes("cancelar")) {
                // Eliminar el pedido actual
                this.clientesEnProcesoDePedido.delete(message.from);
                
                await this.enviarMensaje(message, "Tu pedido ha sido cancelado. ¿En qué más puedo ayudarte hoy?");
                
                return true; // Indica que se procesó el mensaje
            }
            
            // Procesar según el estado del pedido
            switch (pedido.estado) {
                case 'solicitando_datos':
                    // Verificar si es un correo válido
                    if (this.validarCorreo(mensajeUsuario)) {
                        pedido.correoElectronico = mensajeUsuario;
                        pedido.estado = 'solicitando_direccion';
                        
                        await this.enviarMensaje(message, `Gracias por tu correo: ${mensajeUsuario}\n\nAhora, por favor envíame tu *dirección completa* para la entrega.\n\nRecuerda que puedes escribir "3" para ver otro producto o "4" para cancelar.`);
                    } else {
                        await this.enviarMensaje(message, `Por favor, envía un correo electrónico válido (ejemplo: nombre@dominio.com).\n\nO escribe "3" para ver otro producto, o "4" para cancelar.`);
                    }
                    break;
                    
                case 'solicitando_direccion':
                    if (mensajeUsuario.length > 5) {  // Verificación simple de longitud de dirección
                        pedido.direccion = mensajeUsuario;
                        pedido.estado = 'completado';
                        
                        // Generar número de pedido
                        const numeroPedido = Math.floor(100000 + Math.random() * 900000);
                        
                        // Mensaje de confirmación
                        let mensajeConfirmacion = `*🎉 ¡Tu pedido ha sido registrado exitosamente!*\n\n`;
                        mensajeConfirmacion += `*Número de pedido:* #${numeroPedido}\n`;
                        mensajeConfirmacion += `*Producto:* ${pedido.producto.nombre_producto}\n`;
                        mensajeConfirmacion += `*Precio:* $${pedido.producto.precio_sugerido}\n`;
                        mensajeConfirmacion += `*Correo:* ${pedido.correoElectronico}\n`;
                        mensajeConfirmacion += `*Dirección:* ${pedido.direccion}\n\n`;
                        mensajeConfirmacion += `Un representante se pondrá en contacto contigo pronto para coordinar los detalles de entrega. ¡Gracias por tu compra!\n\n`;
                        mensajeConfirmacion += `¿Deseas ver más productos? Puedes decirme qué categoría te interesa.`;
                        
                        await this.enviarMensaje(message, mensajeConfirmacion);
                        
                        // Eliminar el pedido completado
                        this.clientesEnProcesoDePedido.delete(message.from);
                        
                        // Actualizar el contexto de conversación
                        this.conversacionCache += `[Pedido completado: ${pedido.producto.nombre_producto}]\n`;
                    } else {
                        await this.enviarMensaje(message, `Por favor, escribe una dirección completa y válida para poder realizar la entrega.\n\nO escribe "3" para ver otro producto, o "4" para cancelar.`);
                    }
                    break;
                    
                default:
                    await this.enviarMensaje(message, `Lo siento, ha ocurrido un error con tu pedido. Por favor, intenta nuevamente o escribe "cancelar" para empezar de nuevo.`);
                    this.clientesEnProcesoDePedido.delete(message.from);
                    break;
            }
            
            return true; // Indica que se procesó el mensaje como parte del proceso de compra
            
        } catch (error) {
            console.error('Error en procesarDatosCliente:', error);
            await this.enviarMensaje(message, 'Lo siento, ocurrió un error al procesar tus datos. Por favor, intenta nuevamente.');
            
            // Eliminar pedido en caso de error
            this.clientesEnProcesoDePedido.delete(message.from);
            
            return false;
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