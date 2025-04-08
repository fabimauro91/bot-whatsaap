const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/database');

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

const Sucursal = sequelize.define('Sucursal', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'id'
  },
  codigo_sucursal: {
    type: DataTypes.BIGINT.UNSIGNED,
    allowNull: false
  },
  nombre_sucursal: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'nombre_sucursal'
  },
  direccion: {
    type: DataTypes.STRING(250),
    allowNull: true
  },
  telefono: {
    type: DataTypes.STRING(20),
    allowNull: true
  }
}, {
  tableName: 'sucursal',
  timestamps: false
});

module.exports = Sucursal; 