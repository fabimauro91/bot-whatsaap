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
    logging: false  // Desactivar logs SQL
  }
);

const WhatsappInstance = sequelize.define('WhatsappInstance', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  instance_id: {
    type: DataTypes.STRING(36),
    allowNull: false,
    unique: true
  },
  codigo_sucursal: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false,
    references: {
      model: 'sucursal',
      key: 'codigo_sucursal'
    }
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'pending'
  },
  phone_number: {
    type: DataTypes.STRING,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  },
  last_connected: {
    type: DataTypes.DATE
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'whatsapp_instances',
  timestamps: false
});

// Definir la relación con Sucursal
WhatsappInstance.belongsTo(Sucursal, {
  foreignKey: 'codigo_sucursal',
  targetKey: 'codigo_sucursal'
});

module.exports = WhatsappInstance; 