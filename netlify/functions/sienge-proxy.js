const SIENGE_BASE = 'https://api.sienge.com.br/engefy/public/api/v1';
const SIENGE_USER = 'engefy-dash';
const SIENGE_PASS = 'QdUOY0Lgwmp7ggyQKgJrNM50PF44Zxi3';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    let endpoint = params.endpoint || '';

    if (!endpoint) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Parâmetro "endpoint" é obrigatório' })
      };
    }

    if (!endpoint.startsWith('/')) endpoint = '/' + endpoint;

    const extraParams = { ...params };
    delete extraParams.endpoint;
    let url = `${SIENGE_BASE}${endpoint}`;
    const queryParts = Object.entries(extraParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (queryParts) url += (url.includes('?') ? '&' : '?') + queryParts;

    const auth = Buffer.from(`${SIENGE_USER}:${SIENGE_PASS}`).toString('base64');
    const fetchOptions = {
      method: event.httpMethod,
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (event.body && ['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
      fetchOptions.body = event.body;
    }

    const response = await fetch(url, fetchOptions);
    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) { data = await response.json(); }
    else { data = await response.text(); }

    return {
      statusCode: response.status,
      headers: CORS_HEADERS,
      body: typeof data === 'string' ? data : JSON.stringify(data),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Erro no proxy', message: error.message }),
    };
  }
};
