// Fake WhatsApp Cloud API (Graph API) for testing. Mimics Meta's responses and error format.
const http = require('http');

const calls = [];
let wamid = 0;
const throttled = new Map(); // phone -> times throttled so far

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
const metaError = (code, message) => ({ error: { message, type: 'OAuthException', code, fbtrace_id: 'x' } });

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;

      if (path === '/__calls') return send(res, 200, calls);
      if (path === '/__reset') { calls.length = 0; throttled.clear(); return send(res, 200, {}); }
      if (path === '/img.jpg') {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        return res.end(Buffer.alloc(2048, 7));
      }

      let body = null;
      try { body = raw.length && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : null; } catch {}
      const auth = req.headers['authorization'] || '';
      calls.push({ t: Date.now(), method: req.method, path, body, auth, bytes: raw.length });

      // Fake Anthropic Messages API for bot AI answers: replies with the knowledge line that shares a
      // word with the question, or NO_ANSWER
      if (path === '/v1/messages' && req.method === 'POST') {
        if (req.headers['x-api-key'] !== 'test-ai-key') return send(res, 401, { type: 'error', error: { message: 'invalid x-api-key' } });
        const knowledge = (body.system.match(/<business_information>\n([\s\S]*)\n<\/business_information>/) || [])[1] || '';
        const q = String(body.messages[body.messages.length - 1].content).toLowerCase();
        const words = q.split(/\W+/).filter((w) => w.length > 3);
        const line = knowledge.split('\n').find((l) => words.some((w) => l.toLowerCase().includes(w)));
        return send(res, 200, { content: [{ type: 'text', text: line ? `As per our info: ${line.trim()}` : 'NO_ANSWER' }] });
      }

      if (!auth.includes('good-token')) return send(res, 401, metaError(190, 'Invalid OAuth access token'));

      // POST /v23.0/{phone-number-id}/messages
      let m = path.match(/^\/v[\d.]+\/(\w+)\/messages$/);
      if (m && req.method === 'POST') {
        const to = body?.to || '';
        if (to.endsWith('3333')) return send(res, 400, metaError(132001, 'Template name does not exist in the translation'));
        if (to.endsWith('2222')) {
          const n = throttled.get(to) || 0;
          if (n < 2) {
            throttled.set(to, n + 1);
            return send(res, 400, metaError(130429, 'Rate limit hit'), { 'retry-after': '1' });
          }
        }
        if (to.endsWith('5555')) return send(res, 503, { error: { message: 'Service temporarily unavailable', code: 2 } });
        return send(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: `wamid.${++wamid}` }] });
      }
      // POST /{waba}/message_templates
      m = path.match(/^\/v[\d.]+\/(\w+)\/message_templates$/);
      if (m && req.method === 'POST') return send(res, 200, { id: `55500${calls.length}`, status: 'PENDING', category: body.category });
      // Resumable upload: create session, then upload bytes
      m = path.match(/^\/v[\d.]+\/(\w+)\/uploads$/);
      if (m && req.method === 'POST') return send(res, 200, { id: 'upload:session1' });
      if (path.endsWith('/upload:session1') && req.method === 'POST') return send(res, 200, { h: 'HANDLE-123' });
      // GET template status
      m = path.match(/^\/v[\d.]+\/(55500\d+)$/);
      if (m) return send(res, 200, { status: 'APPROVED', rejected_reason: 'NONE' });
      // GET phone number info
      m = path.match(/^\/v[\d.]+\/(\d+)$/);
      if (m) return send(res, 200, { display_phone_number: '+1 555-010-0001', verified_name: 'We Brand 360', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K', id: m[1] });

      send(res, 404, metaError(100, `Unknown path ${path}`));
    });
  })
  .listen(4900, () => console.log('fake meta on 4900'));
