const axios = require('axios');

async function consultarAbacus(mensaje) {
  const endpoint = process.env.ABACUS_API_URL;
  const deploymentToken = process.env.ABACUS_API_KEY;
  const deploymentId = process.env.ABACUS_API_MODEL_ID;

    console.log('endpoint:', endpoint);
    console.log('deploymentToken:', deploymentToken);
    console.log('deploymentId:', deploymentId);
    
  const url = `${endpoint}?deploymentToken=${deploymentToken}&deploymentId=${deploymentId}`;

  const payload = {
    messages: [
      { is_user: true, text: mensaje }
    ],
    llmName: null,
    numCompletionTokens: null,
    systemMessage: null,
    temperature: 0.0,
    filterKeyValues: null,
    searchScoreCutoff: null,
    chatConfig: null,
    userInfo: null
  };

  try {
    const res = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data;
  } catch (err) {
    console.error('Error consultando Abacus:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { consultarAbacus };