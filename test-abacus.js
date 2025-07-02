require('dotenv').config();
const axios = require('axios');

const endpoint = process.env.ABACUS_API_URL;
const deploymentToken = process.env.ABACUS_API_KEY;
const deploymentId = process.env.ABACUS_API_MODEL_ID;

console.log('endpoint:', endpoint);
console.log('deployment_token:', deploymentToken);
console.log('deployment_id:', deploymentId);

const url = `${endpoint}?deploymentToken=${deploymentToken}&deploymentId=${deploymentId}`;

const payload = {
  messages: [
    { is_user: true, text: "¿Cuál es el significado de la vida?" }
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

axios.post(url, payload, {
  headers: { 'Content-Type': 'application/json' }
})
.then(res => {
  console.log('Respuesta:', res.data);
})
.catch(err => {
  console.error('Error:', err.response?.data || err.message);
});