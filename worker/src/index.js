const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
});

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const text = value => String(value ?? '').trim();
const tokenFrom = request => new URL(request.url).searchParams.get('p') || '';
const validName = value => /^[\p{L}\w .-]{1,80}$/u.test(value);
const validDescription = value => value && value.length <= 300;
const MAX_INVOICE_BYTES = 1024 * 1024;

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2_sha256$')) {
    try {
      const [, rounds, saltHex, expected] = stored.split('$');
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(saltHex.match(/.{2}/g).map(x => parseInt(x, 16))), iterations: Number(rounds) }, key, 256);
      const actual = [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return actual === expected;
    } catch { return false; }
  }
  return (await digest(`portal-sol-lala-admin:${password}`)) === stored;
}

async function participant(env, token) {
  if (!token) return null;
  return env.DB.prepare('SELECT id,name,blocked FROM participants WHERE access_token=?1').bind(token).first();
}

async function requireParticipant(env, token) {
  const person = await participant(env, token);
  return person && !person.blocked ? person : null;
}

async function state(env, token) {
  const [participants, items, purchases, invoices, shopping_notes, checkin, checkout, rules, activities, foods, drinks, current] = await Promise.all([
    env.DB.prepare('SELECT id,name,blocked FROM participants WHERE blocked=0 ORDER BY name').all(),
    env.DB.prepare('SELECT * FROM items ORDER BY id DESC').all(),
    env.DB.prepare('SELECT * FROM purchases ORDER BY id DESC').all(),
    env.DB.prepare('SELECT * FROM invoices ORDER BY id DESC').all(),
    env.DB.prepare('SELECT * FROM shopping_notes ORDER BY id DESC').all(),
    env.DB.prepare("SELECT * FROM checklist WHERE kind='checkin' ORDER BY id").all(),
    env.DB.prepare("SELECT * FROM checklist WHERE kind='checkout' ORDER BY id").all(),
    env.DB.prepare('SELECT * FROM rules ORDER BY id').all(),
    env.DB.prepare("SELECT * FROM ideas WHERE kind='atividade' ORDER BY id DESC").all(),
    env.DB.prepare("SELECT * FROM ideas WHERE kind='comida' ORDER BY id DESC").all(),
    env.DB.prepare("SELECT * FROM ideas WHERE kind='bebida' ORDER BY id DESC").all(),
    participant(env, token)
  ]);
  const rows = purchases.results;
  const total = rows.reduce((sum, item) => sum + Number(item.value), 0);
  const names = participants.results.map(item => item.name);
  const share = names.length ? total / names.length : 0;
  const paid = Object.fromEntries(names.map(name => [name, 0]));
  rows.forEach(item => { paid[item.person] = (paid[item.person] || 0) + Number(item.value); });
  const registered = [...new Set(rows.map(item => item.person).filter(Boolean))].sort();
  return {
    participants: participants.results, items: items.results, purchases: rows,     invoices: invoices.results.map(item => ({ ...item, photo: `/api/invoices/file/${item.id}${token ? `?p=${encodeURIComponent(token)}` : ''}` })),
    shopping_notes: shopping_notes.results, checkin: checkin.results, checkout: checkout.results,
    rules: rules.results, activities: activities.results, foods: foods.results, drinks: drinks.results,
    total, share, balances: registered.map(name => ({ name, paid: paid[name] || 0, balance: (paid[name] || 0) - share })),
    current_participant: current && !current.blocked ? current : null
  };
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (url.pathname === '/api/state' && request.method === 'GET') return json(await state(env, tokenFrom(request)), 200, cors);
  const invoiceMatch = url.pathname.match(/^\/api\/invoices\/file\/(\d+)$/);
  if (invoiceMatch && request.method === 'GET') {
    const person = await requireParticipant(env, tokenFrom(request));
    if (!person) return new Response('Forbidden', { status: 403, headers: cors });
    const invoice = await env.DB.prepare('SELECT photo_data,photo_type FROM invoices WHERE id=?1').bind(Number(invoiceMatch[1])).first();
    if (!invoice?.photo_data || !invoice.photo_type) return new Response('Not found', { status: 404, headers: cors });
    const bytes = Uint8Array.from(atob(invoice.photo_data), char => char.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': invoice.photo_type, 'Cache-Control': 'private, no-store', ...cors } });
  }
  let body = {};
  if (request.method !== 'GET') {
    if (Number(request.headers.get('content-length') || 0) > 8 * 1024 * 1024) return json({ error: 'requisição muito grande' }, 413, cors);
    try { body = await request.json(); } catch { return json({ error: 'dados inválidos' }, 400, cors); }
  }
  if (url.pathname === '/api/admin/links' || url.pathname === '/api/admin/block' || url.pathname === '/api/admin/unblock') {
    if (!(await verifyPassword(text(body.password), env.PORTAL_ADMIN_PASSWORD_HASH))) return json({ error: 'não autorizado' }, 401, cors);
    if (url.pathname.endsWith('/links')) {
      const links = await env.DB.prepare('SELECT id,name,access_token,blocked FROM participants ORDER BY name').all();
      return json({ links: links.results.map(item => ({ id: item.id, name: item.name, link: `?p=${item.access_token}`, blocked: Boolean(item.blocked) })) }, 200, cors);
    }
    await env.DB.prepare('UPDATE participants SET blocked=?1 WHERE id=?2').bind(url.pathname.endsWith('/block') ? 1 : 0, Number(body.participant_id)).run();
    return json({ ok: true }, 200, cors);
  }
  const person = await requireParticipant(env, tokenFrom(request));
  if (!person) return json({ error: 'link de participante inválido ou bloqueado' }, 403, cors);
  const description = text(body.description);
  if (request.method === 'POST' && url.pathname === '/api/participants') {
    const name = text(body.name);
    if (!validName(name)) return json({ error: 'nome inválido' }, 400, cors);
    await env.DB.prepare('INSERT OR IGNORE INTO participants(name,access_token) VALUES (?1,?2)').bind(name, crypto.randomUUID().replaceAll('-', '')).run();
  } else if (request.method === 'POST' && url.pathname === '/api/items') {
    if (!validDescription(description)) return json({ error: 'descrição inválida' }, 400, cors);
    await env.DB.prepare('INSERT INTO items(description,person) VALUES (?1,?2)').bind(description, person.name).run();
  } else if (request.method === 'POST' && url.pathname === '/api/purchases') {
    const value = Number(String(body.value ?? '').replace(',', '.'));
    if (!validDescription(description) || !Number.isFinite(value) || value < 0 || value > 1000000) return json({ error: 'compra ou valor inválido' }, 400, cors);
    await env.DB.prepare('INSERT INTO purchases(description,value,person) VALUES (?1,?2,?3)').bind(description, value, person.name).run();
  } else if (request.method === 'POST' && url.pathname === '/api/shopping-notes') {
    if (!validDescription(text(body.note))) return json({ error: 'item inválido' }, 400, cors);
    await env.DB.prepare('INSERT INTO shopping_notes(note,added_by) VALUES (?1,?2)').bind(text(body.note), person.name).run();
  } else if (request.method === 'POST' && url.pathname === '/api/checklist') {
    if (!['checkin', 'checkout'].includes(body.kind) || !validDescription(description)) return json({ error: 'descrição inválida' }, 400, cors);
    await env.DB.prepare('INSERT INTO checklist(kind,description,person,user_added) VALUES (?1,?2,?3,1)').bind(body.kind, description, person.name).run();
  } else if (request.method === 'POST' && url.pathname === '/api/toggle') {
    await env.DB.prepare('UPDATE checklist SET done=CASE done WHEN 0 THEN 1 ELSE 0 END WHERE id=?1').bind(Number(body.id)).run();
  } else if (request.method === 'POST' && url.pathname === '/api/ideas') {
    if (!['atividade', 'comida', 'bebida'].includes(body.kind) || !validDescription(description)) return json({ error: 'sugestão inválida' }, 400, cors);
    await env.DB.prepare('INSERT INTO ideas(kind,description,person) VALUES (?1,?2,?3)').bind(body.kind, description, person.name).run();
  } else if (request.method === 'POST' && url.pathname === '/api/invoices') {
    const match = String(body.photo || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!match) return json({ error: 'envie uma foto válida' }, 400, cors);
    const encoded = match[2];
    const estimatedBytes = Math.floor(encoded.length * 3 / 4);
    if (estimatedBytes > MAX_INVOICE_BYTES) return json({ error: 'a foto deve ter no máximo 1 MB' }, 413, cors);
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    if (bytes.byteLength > MAX_INVOICE_BYTES) return json({ error: 'a foto deve ter no máximo 1 MB' }, 413, cors);
    await env.DB.prepare('INSERT INTO invoices(description,value,added_by,photo,photo_data,photo_type) VALUES (?1,0,?2,?3,?4,?5)')
      .bind('Nota fiscal', person.name, '', encoded, match[1]).run();
  } else if (request.method === 'DELETE' && /^\/api\/(items|purchases|invoices|shopping_notes|checklist|ideas|rules)\/\d+$/.test(url.pathname)) {
    await env.DB.prepare(`DELETE FROM ${url.pathname.split('/')[2]} WHERE id=?1`).bind(Number(url.pathname.split('/').pop())).run();
  } else return json({ error: 'rota inválida' }, 404, cors);
  return json({ ok: true, state: await state(env, tokenFrom(request)) }, 200, cors);
}

export default { async fetch(request, env) { try { return await handle(request, env); } catch (error) { console.error(error); return json({ error: 'erro interno' }, 500, cors); } } };
