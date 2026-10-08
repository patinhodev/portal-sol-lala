const $ = id => document.getElementById(id);
const API_BASE = window.PORTAL_API_BASE || '';
const route = path => `${API_BASE}${path}${location.search}`;
const money = value => Number(value || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function api(url, method = 'GET', data) {
  const response = await fetch(`${API_BASE}${url}`, {method, headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined});
  return response.json();
}
function openGallery() { $('site-gallery').hidden = false; }
function closeGallery() { $('site-gallery').hidden = true; }
function li(text, sub, deletable, table, id) {
  return `<li><div><b>${esc(text)}</b><small>${esc(sub || '')}</small></div>${deletable ? `<button class="ghost" onclick="removeRow('${table}',${id})">Excluir</button>` : ''}</li>`;
}
const participantPhotos = {Ana:'ana.png', Chintia:'chintia.png', Lucas:'lucas.png', Renata:'renata.png', Rodrigo:'rodrigo.png', Tuane:'tuane.png', Vincius:'vinicius.png', Vinicius:'vinicius.png', Fabiano:'fabiano.png'};
async function load() {
  const state = await api('/api/state' + location.search);
  window.lastParticipants = state.participants;
  window.currentParticipant = state.current_participant;
  $('participants').innerHTML = state.participants.map(person => `<span class="chip"><img src="static/${participantPhotos[person.name] || 'logo.png'}" alt=""><span>${esc(person.name)}</span></span>`).join('') || '<span class="muted">Nenhum participante cadastrado.</span>';
  $('purchases').innerHTML = state.purchases.map(item => li(`${item.description} — ${money(item.value)}`, `— Pago integralmente por: ${item.person}`, true, 'purchases', item.id)).join('') || '<li class="muted">Nenhuma compra registrada.</li>';
  $('total').textContent = money(state.total);
  $('share').textContent = money(state.share);
  $('balances').innerHTML = '<h3>Acerto proporcional</h3>' + state.balances.map(item => `<div class="balance"><span>${esc(item.name)}</span><span>pagou ${money(item.paid)}</span><b class="${item.balance >= 0 ? 'positive' : 'negative'}">${item.balance >= 0 ? '+' : ''}${money(item.balance)}</b></div>`).join('') || '<p class="muted">Cadastre participantes para visualizar o acerto.</p>';
  renderShoppingNotes(state.shopping_notes); renderInvoices(state.invoices); renderChecks('checkin', state.checkin); renderChecks('checkout', state.checkout); renderIdeas('activities', state.activities); renderIdeas('foods', state.foods); renderIdeas('drinks', state.drinks);
}
function renderShoppingNotes(items = []) {
  const person = window.currentParticipant?.name || '';
  const identity = person ? `<small class="identified-participant">Registrando como: <b>${esc(person)}</b></small>` : '<small class="identified-participant">Abra seu link individual para adicionar um item.</small>';
  const form = document.querySelector('#shopping-notes form');
  if (form) form.innerHTML = `<textarea id="shopping-note" placeholder="Ex.: gelo, carvão, guardanapos..." required></textarea>${identity}<button ${person ? '' : 'disabled'}>+ Adicionar item</button>`;
  $('shopping-notes-list').innerHTML = items.map(item => `<li><span>${esc(item.note)}<small>Adicionado por: ${esc(item.added_by || 'participante')}</small></span><button class="ghost" onclick="removeRow('shopping_notes',${item.id})">Excluir</button></li>`).join('') || '<li class="muted">Nenhum item registrado.</li>';
}
function renderInvoices(items) {
  let panel = $('invoice-panel');
  if (!panel) { panel = document.createElement('div'); panel.id = 'invoice-panel'; $('compras').appendChild(panel); }
  panel.innerHTML = `<div class="invoice-heading"><h3>🧾 Notas fiscais</h3><p>Fotos de até 1 MB são armazenadas com segurança no banco D1.</p></div><form onsubmit="addInvoice(event)"><label class="invoice-file"><input id="invoice-photo" type="file" accept="image/jpeg,image/png,image/webp" required><span>ANEXAR NOTA FISCAL</span></label><button>+ Adicionar nota fiscal</button></form><button type="button" class="invoice-tab" onclick="toggleInvoices()">🧾 VER NOTAS FISCAIS</button><div id="invoice-list-panel" hidden><ul id="invoices">${items.map(item => `<li><div><b>Nota fiscal</b><small>Adicionada por: ${esc(item.added_by)}</small></div><a class="invoice-photo-link" href="${esc(item.photo)}" target="_blank" rel="noopener">Ver foto</a><button class="ghost" onclick="removeRow('invoices',${item.id})">Excluir</button></li>`).join('') || '<li class="muted">Nenhuma nota fiscal registrada.</li>'}</ul></div>`;
}
function toggleInvoices() { const panel = $('invoice-list-panel'); const button = document.querySelector('.invoice-tab'); if (panel && button) { panel.hidden = !panel.hidden; button.textContent = panel.hidden ? '🧾 VER NOTAS FISCAIS' : '🧾 OCULTAR NOTAS FISCAIS'; } }
function renderChecks(kind, items) { $(kind + 'list').innerHTML = items.map(item => `<li><button class="check ${item.done ? 'done' : ''}" onclick="toggle(${item.id})">${item.done ? '✓' : ''}</button><div class="${item.done ? 'strike' : ''}"><b>${esc(item.description)}</b></div>${item.user_added ? `<button class="ghost" onclick="removeRow('checklist',${item.id})">Excluir</button>` : ''}</li>`).join(''); }
function renderIdeas(id, items) { $(id).innerHTML = items.map(item => li(item.description, '', true, 'ideas', item.id)).join('') || '<li class="muted">Nenhuma sugestão ainda.</li>'; }
async function addParticipant(event) { event.preventDefault(); await api(route('/api/participants'), 'POST', {name: $('pname').value}); event.target.reset(); load(); }
async function addItem(event) { event.preventDefault(); await api(route('/api/items'), 'POST', {description: $('item').value}); event.target.reset(); load(); }
async function addPurchase(event) { event.preventDefault(); await api(route('/api/purchases'), 'POST', {description: $('buy').value, value: $('value').value}); event.target.reset(); load(); }
async function addShoppingNote(event) { event.preventDefault(); const result = await api(route('/api/shopping-notes'), 'POST', {note: $('shopping-note').value}); if (result.error) return alert(result.error); event.target.reset(); load(); }
async function addInvoice(event) { event.preventDefault(); const file = $('invoice-photo').files[0]; if (!file) return; const photo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); const result = await api(route('/api/invoices'), 'POST', {photo}); if (result.error) return alert(result.error); load(); }
async function addCheck(event, kind) { event.preventDefault(); const description = kind === 'checkin' ? $('cin').value : $('cout').value; await api(route('/api/checklist'), 'POST', {kind, description}); event.target.reset(); load(); }
async function addIdea(event, kind) { event.preventDefault(); await api(route('/api/ideas'), 'POST', {kind, description: $(kind).value}); event.target.reset(); load(); }
async function addRule(event) { event.preventDefault(); await api(route('/api/rules'), 'POST', {description: $('rule').value}); event.target.reset(); load(); }
async function toggle(id) { await api(route('/api/toggle'), 'POST', {id}); load(); }
async function removeRow(table, id) { await api(route(`/api/${table}/${id}`), 'DELETE'); load(); }
function fecharModalMascote() { $('modal-mascote')?.remove(); }
document.addEventListener('DOMContentLoaded', () => {
  const modal = $('modal-mascote');
  if (modal) { modal.querySelector('.mascot-modal-close')?.addEventListener('click', fecharModalMascote); modal.addEventListener('click', event => { if (event.target === modal) fecharModalMascote(); }); }
  load();
});
