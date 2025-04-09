// agente.js

const fs = require('fs');
const axios = require('axios');

class Agente {
    constructor() {
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
    }

    // Métodos para gestionar el estado
    setNombreTienda(nombre) {
        this.nombreTienda = nombre;
    }

    setNombreVendedor(nombre) {
        this.nombreVendedor = nombre;
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
                    await message.reply(mensajeProducto);
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('Error en consultarGeminiConProductos:', error);
            throw error;
        }
    }
}

// Exportar la clase
module.exports = Agente;