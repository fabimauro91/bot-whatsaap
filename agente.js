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
        this .conversacionesPorNumero = new Map();

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

        // Método auxiliar para limpiar y estandarizar el formato del número
    cleanPhoneNumber(numero) {
        // Remover el sufijo @c.us y cualquier caracter no numérico
        return numero.replace('@c.us', '').replace(/\D/g, '');
    }

    // Método para obtener o crear el contexto de un número
    getContextoConversacion(numero) {
        try {
            // Limpiar y estandarizar el formato del número
            const numeroLimpio = this.cleanPhoneNumber(numero);
            
            console.log(`Accediendo al contexto para número: ${numeroLimpio} (original: ${numero})`);
            
            if (!this.conversacionesPorNumero.has(numeroLimpio)) {
                console.log(`Creando nuevo contexto para número: ${numeroLimpio}`);
                this.conversacionesPorNumero.set(numeroLimpio, '');
            }
            
            return this.conversacionesPorNumero.get(numeroLimpio);
        } catch (error) {
            console.error('Error en getContextoConversacion:', error);
            console.error('Número recibido:', numero);
            // Retornar un string vacío como fallback
            return '';
        }
    }

    // Método para actualizar el contexto de un número contextoActual + nuevoTexto + '\n'
    actualizarContextoConversacion(numero, nuevoTexto) {
        try {
            const numeroLimpio = this.cleanPhoneNumber(numero);
            const contextoActual = this.getContextoConversacion(numeroLimpio);
            this.conversacionesPorNumero.set(numeroLimpio, contextoActual + nuevoTexto + '\n');
        } catch (error) {
            console.error('Error en actualizarContextoConversacion:', error);
            console.error('Número recibido:', numero);
            console.error('Texto a agregar:', nuevoTexto);
        }

    }

    async consultarGemini(mensaje, genAI) {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            console.error('Antes de contextoConversacion');
            const contextoConversacion = this.getContextoConversacion(mensaje.from);
            console.error('despueed de contextoConversacion');
            
            const promptVendedor = `Cuando inicie una conversacion actue como un vendedor llamado ${this.nombreVendedor}, un vendedor amable y profesional de la tienda ${this.nombreTienda}.
                                  necesitamos verder estos productos: ${contextoProductos}
                                  Responde al siguiente mensaje del cliente: "${mensaje.body}"
                                  sí el cliente escribe alguna palabra de (necesito, quiero, me gustaria), hay que estar atento al complemento de la oracion y buscar entre los productos coincidencia de lo que requiere el cliente
                                  Mantén un tono amable, profesional y orientado a ventas.
                                  Si el cliente muestra interés en alguna caegoria, ofrece los producttos relacionados a la categoria.
                                  tener en cuenta las conversaciones anteriores: "${contextoConversacion}".
                                  Procurar no extenderse mucho con los textos`;

            console.error('Antes enviar a geini');
            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text();
            console.error('despues de consultar a gemini');
            // Actualizar el contexto específico de este número
            this.actualizarContextoConversacion(mensaje.from, textoRespuesta);
            console.error('despues de actualizarConverzacion');
            
            return textoRespuesta;
        } catch (error) {
            console.error('❌ Error al consultar Gemini:', error.mensaje);
            return "Lo siento, en este momento no puedo procesar tu mensaje. ¿Te gustaría ver nuestro catálogo de productos?";
        }
    }

    async consultarGeminiConProductos(mensaje, genAI) {
        try {
            const contextoProductos = JSON.stringify(this.productosCache, null, 2);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

            const contextoConversacion = this.getContextoConversacion(mensaje.from);
           
            const promptVendedor = `
            Contexto: Estos son los productos disponibles: ${contextoProductos}
            Mensaje del usuario: ${mensaje.body}
            Si el usuario está preguntando por información o detalles sobre un producto específico, 
            devuelve el nombre exacto del producto como aparece en la lista.
            Si no está preguntando por un producto específico, devuelve "0".
            Solo devuelve el nombre del producto o "0", sin texto adicional.
            tener esta conversacion anterior: ${contextoConversacion}`;

            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text().trim();
            console.error('consulta productos parecidos  '+textoRespuesta);
            if (textoRespuesta && textoRespuesta !== "0") {
                this.actualizarContextoConversacion(mensaje.from, textoRespuesta );
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
                    if (producto.estado_variacion === 1 && producto.variaciones) {
                        // Agregar sección de variaciones
                        mensajeProducto += `\n*📋 Variaciones Disponibles:*\n`;
                        
                        // Recorrer cada variación
                        producto.variaciones.forEach((variacion, index) => {
                            mensajeProducto += `\n*Variación ${index + 1}:*\n`;
                            mensajeProducto += `   • Talla: ${variacion.talla || 'N/A'}\n`;
                            mensajeProducto += `   • Color: ${variacion.color || 'N/A'}\n`;
                            mensajeProducto += `   • Cantidad: ${variacion.cantidad_disponible || 0} unidades\n`;
                        });
                    }
                    else{
                        mensajeProducto += `*Cantidad disponible:* ${producto.cantidad || 'No especificada'}\n\n`;
                    }
                    
                    mensajeProducto += `¿le gustaria obtenerlo?\nSi lo pide hoy, lo pagas cuando llege a su casa con nuestro servicio de contra-entrega`;

                    this.actualizarContextoConversacion(mensaje.from, mensajeProducto);
                    // Primero enviar el mensaje con la información
                    await this.enviarMensaje(mensaje, mensajeProducto);
                   // Luego enviar las imágenes si existen
                    if (producto.imagenes && producto.imagenes.length > 0) {
                        console.log('Producto tiene imágenes, intentando enviar...');
                        await this.enviarImagenesProducto(mensaje, producto);
                    }
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
            const model = genAI.getGenerativeModel({ 
                model: "gemini-1.5-flash",
                generationConfig: {
                    temperature: 0.2,  // Temperatura baja para respuestas más precisas
                }
            });

            const contextoConversacion = this.getContextoConversacion(message.from);
    
            // Prompt para detectar intención de compra y producto específico
            const promptVendedor = `
            Objetivo: Detectar si el usuario está expresando intención de comprar un producto.
            
            Contexto de la conversación previa:
            ${contextoConversacion}
            
            Mensaje del usuario: "${message.body}"
            
            Ten en cuenta los productos por si el cliente elige una variacion: ${contextoProductos}

            Analiza si el mensaje indica una intención de compra. Considera expresiones como:
            - Afirmaciones directas: "quiero comprarlo", "me lo llevo"
            - Preguntas sobre compra: "¿cómo puedo comprarlo?", "¿cómo lo adquiero?"
            - Respuestas afirmativas: "sí", "ok", "está bien" (especialmente si antes se mencionó si quiere obtener el producto)
            - Interés explícito: "me interesa", "lo necesito"
            
            Si detectas intención de compra, busca en el contexto de la conversación cuál fue el último producto mencionado.
            
            - Pero aun no es una compra si escribe las palabras: "información", "detalles", "saber mas", "conocer". 

            Devuelve SOLO el nombre exacto del producto si hay intención de compra.
            Si hay intención de compra y el producto tiene variacion, se adiciona el nombre el id de la variacion elegida ejemplo (camisa spining | 151).
            Devuelve "0" si no hay clara intención de compra.

            Responde ÚNICAMENTE con el nombre del producto o "0". No incluyas explicaciones ni texto adicional.`;
    
            const result = await model.generateContent(promptVendedor);
            const response = await result.response;
            const textoRespuesta = response.text().trim();
    
            console.log(`Respuesta del análisis de intención de compra: "${textoRespuesta}"`);

            if (textoRespuesta && textoRespuesta !== "0") {

                // Verificar si la respuesta incluye ID de variación
                let productoNombre, idVariacion;

                // Buscar el producto en el cache
                this.actualizarContextoConversacion(message.from, `[Intención de compra detectada para: ${textoRespuesta}]`);

                if (textoRespuesta.includes('|')) {
                    // Si hay variación, el formato será "nombre_producto|id_variacion"
                    //[productoNombre, idVariacion] = textoRespuesta.split('|');
                    [productoNombre, idVariacion] = textoRespuesta.split('|').map(s => s.trim());
                } else {
                    productoNombre = textoRespuesta.trim();
                }

                // Intentar encontrar el producto exacto
                const producto = this.productosCache.find(p => 
                    p.nombre_producto.toLowerCase() === productoNombre.toLowerCase()
                );

                if (!producto) {
                    console.log("✗ No se encontró el producto:", productoNombre);
                    return false;
                }
            
                let variacionSeleccionada = null;
                if (producto.estado_variacion === 1) {
                    if (!idVariacion) {
                        await this.enviarMensaje(message, 
                            "Por favor, especifica la talla y color que deseas del producto.");
                        return false;
                    }
                    
                    variacionSeleccionada = producto.variaciones.find(v => v.id === parseInt(idVariacion));
                    if (!variacionSeleccionada) {
                        await this.enviarMensaje(message, 
                            "La variación seleccionada no está disponible. Por favor, elige otra.");
                        return false;
                    }
                }
            
                await this.iniciarProcesoCompra(message, producto, variacionSeleccionada);
                return true
            }else {
                console.log("✗ No se detectó intención de compra");
                return false; // Indica que no se detectó intención de compra
            }
            
            
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
                    const conversacionActual = this.getContextoConversacion(message.from);
                    // Buscar último producto en conversación
                    for (const p of this.productosCache) {
                        if (conversacionActual.includes(p.nombre_producto)) {
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
    async iniciarProcesoCompra(message, producto, variacionSeleccionada)  {
        try {
            
            // Crear objeto de pedido
            const pedido = {
                producto: producto,
                estado: 'solicitando_datos',
                timestamp: Date.now(),
                codigo_sucursal: producto.id_sucursal,
                id_producto: producto.id_producto,
                nombre_producto: producto.nombre_producto,
                telefono: message.from.replace(/\D/g, ''),
                precio: producto.precio_sugerido,
                // Información de variación
                estado_variacion: producto.estado_variacion,
                id_variacion: variacionSeleccionada ? variacionSeleccionada.id : null,
                variacion_detalle: variacionSeleccionada ? {
                    talla: variacionSeleccionada.talla,
                    color: variacionSeleccionada.color
                } : null
            };
    
            // Guardar en el contexto del usuario
            this.clientesEnProcesoDePedido.set(message.from, pedido);
    
             // Enviar mensaje solicitando datos
             let mensajeSolicitud = `*🛍️ ¡Excelente elección!*\n\n`;
            mensajeSolicitud += `Has seleccionado:\n`;
            mensajeSolicitud += `*${producto.nombre_producto}*\n`;
            if(producto.estado_variacion===1){
                mensajeSolicitud += `*${pedido.variacion_detalle}*\n\n`;
            }
            mensajeSolicitud += `Precio: $${producto.precio_sugerido}\n\n`;
            mensajeSolicitud += `Para finalizar tu compra, necesito algunos datos:\n`;
            mensajeSolicitud += `Sique los siguientes pasos\n\n`;
            mensajeSolicitud += `*1.* Tu nombre completo\n`;
            mensajeSolicitud += `*2.* Tu correo electrónico\n`;
            mensajeSolicitud += `*3.* Tu dirección de entrega\n\n`;
            mensajeSolicitud += `*4.* Tu ciudad de entrega\n`;          
            mensajeSolicitud += `*Responde primero con tu nombre completo*, luego te pediré los otros datos.\n\n`;
            mensajeSolicitud += `📌 También puedes:\n`;
            mensajeSolicitud += `*5.* Escribir "otro producto" para buscar un producto diferente\n`;
            mensajeSolicitud += `*6.* Escribir "cancelar" para cancelar la compra\n`;
     
            this.actualizarContextoConversacion(message.from, mensajeSolicitud );
            await this.enviarMensaje(message, mensajeSolicitud);
        } catch (error) {
            console.error('Error al iniciar proceso de compra:', error);
            throw error;
        }
    }
    
    // Función para procesar la respuesta del cliente con sus datos
    async procesarDatosCliente(message) {
        try {
            // Verificar si el usuario tiene un pedido en proceso
            const from = message.from || message;
            const body = message.body || message;
            const pedido = this.clientesEnProcesoDePedido.get(from);
            
            if (!pedido) {
                return false; // No hay pedido en proceso para este usuario
            }
            const mensajeUsuario = message.body.trim();
            // Verificar comandos especiales
            const mensajeLower = mensajeUsuario.toLowerCase();
            
            // Opción para buscar otro producto
            if (mensajeLower === "5" || mensajeLower === "otro producto" || mensajeLower.includes("otro producto")) {
                // Eliminar el pedido actual
                this.clientesEnProcesoDePedido.delete(from);
                
                // Añadir al contexto para recordar que el usuario estaba comprando
                this.actualizarContextoConversacion(from,"[Usuario solicitó ver otros productos]");

                
                await this.enviarMensaje(message, "¿Qué otro producto te gustaría ver? Puedes decirme la categoría o el nombre del producto que buscas.");
                
                
                return true; // Indica que se procesó el mensaje
            }
            
            // Opción para cancelar
            if (mensajeLower === "6" || mensajeLower === "cancelar" || mensajeLower.includes("cancelar")) {
                // Eliminar el pedido actual
                this.clientesEnProcesoDePedido.delete(from);
                
                // Añadir al contexto para recordar que el usuario estaba comprando
                this.actualizarContextoConversacion(from, textoRespuesta +"[Usuario canseló el pedido]");

                await this.enviarMensaje(message, "Tu pedido ha sido cancelado. ¿En qué más puedo ayudarte hoy?");
                
                return true; // Indica que se procesó el mensaje
            }
            // Procesar según el estado del pedido
            switch (pedido.estado) {
                case 'solicitando_datos':
                    if (body.length < 3) {
                        await this.enviarMensaje(message, 
                            "Por favor, ingresa un nombre válido (mínimo 3 caracteres)");
                        return true;
                    }
                    // Guardar nombre del cliente
                    pedido.nombre_cliente = body;
                    pedido.estado = 'solicitando_correo';
                    await this.enviarMensaje(message, `*✅ Nombre registrado*\n\nAhora por favor envía tu correo electrónico.`);
                    return true;
    
                case 'solicitando_correo':
                    if (this.validarCorreo(body)) {
                        pedido.email = body;
                        pedido.estado = 'solicitando_direccion';
                        await this.enviarMensaje(message, `*✅ Correo registrado*\n\nAhora por favor envía la direccion, incluyendo:\n- Calle/Avenida\n- Número\n- Referencias.` );
                    } else {
                        await this.enviarMensaje(message, '⚠️ Por favor, envía un correo electrónico válido.');
                    }
                    return true;
                
                case 'solicitando_direccion':
                    if (mensajeUsuario.length > 5) {  // Verificación simple de longitud de dirección
                    // Guardar nombre del cliente    
                    pedido.direccion = body;
                    pedido.estado = 'solicitando_ciudad';
                    await this.enviarMensaje(message, `*✅ Direccion registrada*\n\nAhora por favor envía la ciudad de entrega`);
                    return true;
                    } else {
                        await this.enviarMensaje(message, `Por favor, escribe una dirección completa y válida para poder realizar la entrega.\n\nO escribe "5" para ver otro producto, o "6" para cancelar.`);
                    }
                case 'solicitando_ciudad':
                    pedido.ciudad = body;
                    pedido.estado = 'completado';
    
                    // Guardar en la base de datos
                    try {

                        const numeroPedido = Math.floor(100000 + Math.random() * 900000);
                        pedido.numeroPedido = numeroPedido;
                        await this.guardarPedidoEnBD(pedido);
                        
                        // Generar resumen del pedido
                        let resumenPedido = `*🎉 ¡Pedido Confirmado!*\n\n`;
                        if(pedido.producto.estado_variacion===1){
                            resumenPedido += `*Producto:* ${pedido.nombre_producto} ${pedido.variacion_detalle}\n`;
                        }else{
                            resumenPedido += `*Producto:* ${pedido.nombre_producto}\n`;
                        }
                        
                        resumenPedido += `*Número de pedido:* #${numeroPedido}\n`;
                        resumenPedido += `*Nombre:* ${pedido.nombre_cliente}\n`;
                        resumenPedido += `*Correo:* ${pedido.email}\n`;
                        resumenPedido += `*Teléfono:* ${pedido.telefono}\n`;
                        resumenPedido += `*Dirección:* ${pedido.direccion}\n\n`;
                        resumenPedido += `*Ciudad:* ${pedido.ciudad}\n\n`;
                        resumenPedido += `Un representante se pondrá en contacto contigo pronto para coordinar los detalles de entrega. ¡Gracias por tu compra!\n\n`;
                        resumenPedido += `¿Deseas ver más productos? Puedes decirme qué categoría te interesa.`;
                        
                        
                        
                        // Actualizar el contexto de conversación
                        this.actualizarContextoConversacion(message.from,'[Pedido completado: '+pedido.producto.nombre_producto);


                        // Eliminar el pedido completado
                        this.clientesEnProcesoDePedido.delete(message.from);
                    
                        await this.enviarMensaje(message, resumenPedido);
                    } catch (error) {
                        console.error('Error al guardar el pedido:', error);
                        await this.enviarMensaje(message, '⚠️ Lo sentimos, hubo un error al procesar tu pedido. Por favor, intenta nuevamente más tarde.');
                    }
                    return true;
                default:
                    await this.enviarMensaje(message, `Lo siento, ha ocurrido un error con tu pedido. Por favor, intenta nuevamente o escribe "cancelar" para empezar de nuevo.`);
                    this.clientesEnProcesoDePedido.delete(message.from);
                    break;
            }
            return true; // Indica que se procesó el mensaje como parte del proceso de compra
            
        } catch (error) {
            console.error('Error al procesar datos del cliente:', error);
            throw error;
        }
    return false;
    }

    async guardarPedidoEnBD(pedido) {
        try {
            // Validar datos requeridos
            if (!pedido.codigo_sucursal || !pedido.id_producto || !pedido.nombre_producto) {
                throw new Error('Faltan datos requeridos del producto');
            }

            if (!pedido.nombre_cliente || !pedido.email || !pedido.direccion) {
                throw new Error('Faltan datos requeridos del cliente');
            }

            const nuevoPedido = await PedidosWhatsapp.create({
                codigo_sucursal: pedido.codigo_sucursal,
                id_producto: pedido.id_producto,
                id_variacion: pedido.id_variacion, // Nuevo campo
                numero_pedido: pedido.numeroPedido,
                nombre_producto: pedido.nombre_producto,
                nombre_cliente: pedido.nombre_cliente,
                direccion: pedido.direccion,
                ciudad:pedido.ciudad,
                telefono: pedido.telefono,
                email: pedido.email,
                estado: 'pendiente',
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
    async enviarImagenesProducto(message, producto) {
        try {
            if (!producto.imagenes || !Array.isArray(producto.imagenes) || producto.imagenes.length === 0) {
                console.log('El producto no tiene imágenes disponibles');
                return;
            }
    
            const { MessageMedia } = require('whatsapp-web.js');
    
            // Informar al usuario que se están cargando las imágenes
            await this.enviarMensaje(message, '*📸 Enviando imágenes del producto...*');
    
            let imagenesEnviadas = 0;
            for (const imagen of producto.imagenes) {
                try {
                    if (!imagen.url_imagen || typeof imagen.url_imagen !== 'string') {
                        console.log('URL de imagen no válida:', imagen);
                        continue;
                    }
    
                    console.log('Cargando imagen desde URL:', imagen.url_imagen);
                    
                    try {
                        const media = await MessageMedia.fromUrl(imagen.url_imagen, {
                            unsafeMime: true
                        });
    
                        // Usar el método client.sendMessage en lugar de message.reply
                        await this.whatsappClient.sendMessage(message.from, media);
                        imagenesEnviadas++;
    
                    } catch (mediaError) {
                        console.error('Error al cargar la imagen:', mediaError);
                        continue;
                    }
    
                    // Esperar entre envíos
                    await new Promise(resolve => setTimeout(resolve, 1500));
    
                } catch (imgError) {
                    console.error('Error al procesar imagen:', imgError);
                    console.error('URL de la imagen:', imagen.url_imagen);
                    continue;
                }
            }
    
            if (imagenesEnviadas > 0) {
                console.log(`✅ Se enviaron ${imagenesEnviadas} imágenes correctamente`);
            } else {
                console.log('❌ No se pudo enviar ninguna imagen');
                await this.enviarMensaje(message, '⚠️ Lo siento, no se pudieron cargar las imágenes del producto en este momento.');
            }
    
        } catch (error) {
            console.error('Error al enviar imágenes del producto:', error);
            await this.enviarMensaje(message, '⚠️ Hubo un problema al mostrar las imágenes del producto.');
            throw error;
        }
    }
    // En agente.js

    async enviarMensajePresentacion(numeroTelefono) {
        try {
            // Verificar que el cliente de WhatsApp esté inicializado
            if (!this.whatsappClient) {
                throw new Error('Cliente de WhatsApp no inicializado');
            }

            // Verificar el estado del cliente
            const clientState = await this.whatsappClient.getState().catch(() => null);
            if (!clientState || clientState !== 'CONNECTED') {
                throw new Error('Cliente de WhatsApp no está conectado');
            }

            // Validar el formato del número de teléfono
            const numeroLimpio = this.cleanPhoneNumber(numeroTelefono);
            if (!numeroLimpio) {
                throw new Error('Número de teléfono inválido');
            }

            // Verificar que haya productos cargados
            if (!this.productosCache || this.productosCache.length === 0) {
                throw new Error('No hay productos cargados');
            }

            // Obtener categorías únicas de los productos en cache
            const categoriasUnicas = new Set();
            this.productosCache.forEach(producto => {
                if (producto.id_categoria) {
                    categoriasUnicas.add(producto.id_categoria);
                }
            });

            if (categoriasUnicas.size === 0) {
                throw new Error('No hay categorías disponibles');
            }

            // Crear el mensaje de presentación
            let mensajePresentacion = `*¡Hola! 👋*\n\n`;
            mensajePresentacion += `Bienvenido a *${this.nombreTienda}* 🏪\n`;
            mensajePresentacion += `Mi nombre es *${this.nombreVendedor}* y seré tu asesor personal de ventas.\n\n`;
            mensajePresentacion += `*🛍️ Nuestras Categorías Disponibles:*\n\n`;

            // Contar productos por categoría
            const productosPorCategoria = {};
            this.productosCache.forEach(producto => {
                if (producto.id_categoria) {
                    productosPorCategoria[producto.id_categoria] = 
                        (productosPorCategoria[producto.id_categoria] || 0) + 1;
                }
            });

            // Ordenar y formatear categorías
            const categoriasOrdenadas = Array.from(categoriasUnicas)
                .sort((a, b) => a.localeCompare(b))
                .map(categoria => {
                    const cantidadProductos = productosPorCategoria[categoria] || 0;
                    return `• *${categoria}* (${cantidadProductos} ${cantidadProductos === 1 ? 'producto' : 'productos'})`;
                });

            mensajePresentacion += categoriasOrdenadas.join('\n');
            mensajePresentacion += `\n\n*¿Cómo puedo ayudarte hoy?*\n`;
            mensajePresentacion += `• Puedes preguntarme por cualquier categoría\n`;
            mensajePresentacion += `• Buscar productos específicos\n`;
            mensajePresentacion += `• O decirme qué estás buscando\n\n`;
            mensajePresentacion += `¡Estoy aquí para ayudarte a encontrar lo que necesitas! 😊\n\n`;
            mensajePresentacion += `*💡 Ejemplo:* Puedes escribir "Quiero ver productos de ${Array.from(categoriasUnicas)[0]}"`;

            // Intentar enviar el mensaje con reintentos
            let intentos = 0;
            const maxIntentos = 3;
            let error;

            while (intentos < maxIntentos) {
                try {
                    // Verificar nuevamente el estado antes de enviar
                    const estado = await this.whatsappClient.getState().catch(() => null);
                    if (!estado || estado !== 'CONNECTED') {
                        throw new Error('Cliente desconectado');
                    }

                    await this.whatsappClient.sendMessage(
                        `${numeroLimpio}@c.us`,
                        mensajePresentacion
                    );

                    // Si llegamos aquí, el mensaje se envió correctamente
                    this.actualizarContextoConversacion(
                        numeroLimpio,
                        '[Inicio de conversación - Mensaje de presentación enviado]'
                    );

                    return {
                        success: true,
                        mensaje: 'Mensaje de presentación enviado exitosamente',
                        categoriasMostradas: Array.from(categoriasUnicas),
                        intentos: intentos + 1
                    };
                } catch (err) {
                    error = err;
                    intentos++;
                    if (intentos < maxIntentos) {
                        // Esperar antes de reintentar
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            // Si llegamos aquí, todos los intentos fallaron
            throw new Error(`No se pudo enviar el mensaje después de ${maxIntentos} intentos: ${error.message}`);

        } catch (error) {
            console.error('Error al enviar mensaje de presentación:', error);
            throw {
                error: 'Error al enviar mensaje de presentación',
                detalle: error.message,
                tipo: error.name
            };
        }
    }
}

// Exportar la clase
module.exports = Agente;