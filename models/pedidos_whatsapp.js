const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/database');
const Sucursal = require('./Sucursal');

const sequelize = new Sequelize(
  config.development.database,
  config.development.username,
  config.development.password,
  {
    host: config.development.host,
    port: config.development.port,
    dialect: config.development.dialect,
    logging: false
  }
);

const PedidosWhatsapp = sequelize.define('PedidosWhatsapp', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'id'
  },
  numero_pedido: {
    type: DataTypes.BIGINT(20),
    allowNull: true
},
  codigo_sucursal: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: {
      model: Sucursal,
      key: 'codigo_sucursal'
    }
  },
  id_producto: {
    type: DataTypes.BIGINT(20),
    allowNull: false,
    references: {
      model: 'Inventario',
      key: 'id_producto'
    }
  },
  nombre_producto: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  nombre_cliente: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  direccion: {
    type: DataTypes.STRING(250),
    allowNull: false
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'pendiente'
  }
}, {
  tableName: 'pedidos_whatsapp',
  timestamps: false
});

// Definir la relación con Sucursal
PedidosWhatsapp.belongsTo(Sucursal, {
  foreignKey: 'codigo_sucursal',
  targetKey: 'codigo_sucursal',
  as: 'sucursal'
});

module.exports = PedidosWhatsapp;