const API = "/api/entries";
const PEOPLE_API = "/api/people";
const PRODUCTS_API = "/api/products";

let entries = [];
let products = [];          // catálogo ativo
let people = [];            // nomes cadastrados (persistem mesmo sem lançamentos)
let phones = {};            // { nomeMinusculo: telefone }
let activeFilter = null;
let sortKey = "date";
let sortDir = -1;
let modalPerson = null;

const FALLBACK_PROFIT = 4.80;   // lucro padrão p/ lançamentos antigos sem registro

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmt(val) {
  return Number(val).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso) {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function initDate() {
  const input = document.getElementById("inputDate");
  const d = new Date();
  const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // A chave leva o dia de hoje: a data escolhida sobrevive a recarregar, mas não vale para o dia seguinte.
  const key = `dataLancamento:${today}`;
  input.value = sessionStorage.getItem(key) || today;
  input.addEventListener("change", () => sessionStorage.setItem(key, input.value));
}

function showError(msg) {
  document.getElementById("formError").textContent = msg;
  setTimeout(() => { document.getElementById("formError").textContent = ""; }, 3000);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function loadEntries() {
  const [entriesRes, peopleRes, productsRes] = await Promise.all([
    fetch(API), fetch(PEOPLE_API), fetch(`${PRODUCTS_API}?active=1`),
  ]);
  entries = await entriesRes.json();
  products = await productsRes.json();

  phones = {};
  people = [];
  (await peopleRes.json()).forEach(p => {
    phones[p.name.toLowerCase()] = p.phone || "";
    people.push(p.name);
  });

  updateProductSelect();
  render();
}

function selectedProduct() {
  const id = Number(document.getElementById("inputProduct").value);
  return products.find(p => p.id === id) || null;
}

function updateProductSelect() {
  const sel = document.getElementById("inputProduct");
  const prev = sel.value;
  if (!products.length) {
    sel.innerHTML = `<option value="">Nenhum produto — cadastre em Produtos</option>`;
  } else {
    sel.innerHTML = products
      .map(p => `<option value="${p.id}">${p.name} — ${fmt(p.price)}</option>`)
      .join("");
    if (prev && products.some(p => String(p.id) === prev)) sel.value = prev;
  }
  updateValueDisplay();
}

function updateValueDisplay() {
  const disp = document.getElementById("valueDisplay");
  const prod = selectedProduct();
  const qty = parseInt(document.getElementById("inputQty").value, 10) || 0;
  disp.value = prod ? `${fmt(prod.price * qty)} (un. ${fmt(prod.price)})` : "—";
}

async function addEntry() {
  const name = document.getElementById("inputName").value.trim();
  const qty  = parseInt(document.getElementById("inputQty").value, 10);
  const date = document.getElementById("inputDate").value;
  const prod = selectedProduct();

  if (!name)              return showError("Informe o nome da pessoa.");
  if (!prod)              return showError("Selecione um produto (cadastre em Produtos).");
  if (!qty || qty < 1)    return showError("Informe uma quantidade válida.");

  const btn = document.getElementById("btnAdd");
  btn.disabled = true;

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, product_id: prod.id, quantity: qty, date, tz_offset: new Date().getTimezoneOffset() }),
  });

  btn.disabled = false;

  if (!res.ok) {
    const err = await res.json();
    return showError(err.error || "Erro ao adicionar.");
  }

  document.getElementById("inputName").value = "";
  document.getElementById("inputQty").value  = "1";
  await loadEntries();
}

async function setPhone(name) {
  const current = phones[name.toLowerCase()] || "";
  const phone = prompt(`Telefone de "${name}" (deixe vazio para remover):`, current);
  if (phone === null) return;            // cancelou
  await fetch(`${PEOPLE_API}/${encodeURIComponent(name)}/phone`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: phone.trim() }),
  });
  await loadEntries();
}

async function deleteEntry(id) {
  if (!confirm("Remover este lançamento?")) return;
  await fetch(`${API}/${id}`, { method: "DELETE" });
  await loadEntries();
  if (modalPerson) openModal(modalPerson);
}

async function clearPerson() {
  if (!modalPerson) return;
  if (!confirm(`Zerar "${modalPerson}"?\n\nTodos os lançamentos serão apagados, mas a pessoa continua na lista.`)) return;
  const name = modalPerson;
  await fetch(`${API}/person/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadEntries();
  openModal(name);            // pessoa segue na lista, agora zerada
}

async function clearPaid() {
  if (!confirm("Zerar todos os lançamentos pagos?\n\nEles serão apagados de vez (inclusive do dashboard). Faça um backup antes se quiser guardar o histórico.")) return;
  const res = await fetch(`${API}/paid`, { method: "DELETE" });
  alert((await res.json()).message);
  await loadEntries();
}

async function deletePerson() {
  if (!modalPerson) return;
  if (!confirm(`Excluir "${modalPerson}" da lista de pessoas?\n\nIsso apaga também os lançamentos dela.`)) return;
  await fetch(`${PEOPLE_API}/${encodeURIComponent(modalPerson)}`, { method: "DELETE" });
  if (activeFilter && activeFilter.toLowerCase() === modalPerson.toLowerCase()) activeFilter = null;
  closeModalDirect();
  await loadEntries();
}

// ── Pagamento ─────────────────────────────────────────────────────────────────

async function togglePaid(id, paid) {
  await fetch(`${API}/${id}/paid`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paid }),
  });
  await loadEntries();
  if (modalPerson) openModal(modalPerson);
}

async function setPersonPaid(name, paid) {
  await fetch(`${API}/person/${encodeURIComponent(name)}/paid`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paid }),
  });
  await loadEntries();
  if (modalPerson) openModal(modalPerson);
}

function pendingTotalFor(name) {
  return entries
    .filter(e => e.name.toLowerCase() === name.toLowerCase() && !e.paid)
    .reduce((s, e) => s + e.amount, 0);
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

function buildChargeMessage(name) {
  const pendentes = entries
    .filter(e => e.name.toLowerCase() === name.toLowerCase() && !e.paid)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const total = pendentes.reduce((s, e) => s + e.amount, 0);
  const totalQtd = pendentes.reduce((s, e) => s + e.quantity, 0);

  return `Olá!\n\nReferente aos salgados do mês:\n\n*${totalQtd} un. — ${fmt(total)}*\n\nChave Pix: falcaogremiosalgado@gmail.com\n\nObrigado!`;
}

function sendWhatsapp(name) {
  const pending = pendingTotalFor(name);
  if (pending <= 0.0001) {
    alert(`${name} não tem valores pendentes. 🎉`);
    return;
  }

  const phone = phones[name.toLowerCase()] || "";
  let digits = phone.replace(/\D/g, "");
  if (!digits) {
    alert(`Cadastre o telefone de "${name}" para enviar a cobrança.`);
    return setPhone(name);
  }
  if (!digits.startsWith("55")) digits = "55" + digits;   // código do Brasil

  const url = `https://wa.me/${digits}?text=${encodeURIComponent(buildChargeMessage(name))}`;
  window.open(url, "_blank");
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderStats();
  renderPanel();
  renderTable();
  updateSuggestions();
}

function renderStats() {
  const total   = entries.reduce((s, e) => s + e.amount, 0);
  const pending = entries.reduce((s, e) => s + (e.paid ? 0 : e.amount), 0);
  const qty     = entries.reduce((s, e) => s + (e.quantity || 0), 0);
  const profit  = entries.reduce((s, e) => s + (e.quantity || 0) * (e.unit_profit ?? FALLBACK_PROFIT), 0);
  const nPeople = allPeople().length;
  document.getElementById("statTotal").textContent   = fmt(total);
  document.getElementById("statPending").textContent = fmt(pending);
  document.getElementById("statCount").textContent   = qty;
  document.getElementById("statProfit").textContent  = fmt(profit);
  document.getElementById("statPeople").textContent  = nPeople;
}

// Nomes cadastrados + nomes que aparecem em lançamentos, sem duplicar (case-insensitive)
function allPeople() {
  const map = {};
  people.forEach(n => { map[n.toLowerCase()] = n; });
  entries.forEach(e => { if (!map[e.name.toLowerCase()]) map[e.name.toLowerCase()] = e.name; });
  return Object.values(map);
}

function renderPanel() {
  const grid = document.getElementById("totalsGrid");
  const map  = {};

  // Toda pessoa cadastrada aparece, mesmo zerada (sem lançamentos).
  allPeople().forEach(n => {
    map[n.toLowerCase()] = { name: n, total: 0, count: 0, pending: 0 };
  });

  entries.forEach(e => {
    const key = e.name.toLowerCase();
    if (!map[key]) map[key] = { name: e.name, total: 0, count: 0, pending: 0 };
    map[key].total += e.amount;
    map[key].pending += e.paid ? 0 : e.amount;
    map[key].count++;
  });

  const sorted = Object.values(map).sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR")
  );

  if (!sorted.length) {
    grid.innerHTML = '<p class="empty-msg">Nenhum lançamento ainda.</p>';
    return;
  }

  grid.innerHTML = sorted.map(p => {
    const isActive = activeFilter && activeFilter.toLowerCase() === p.name.toLowerCase();
    const phone = phones[p.name.toLowerCase()] || "";
    const phoneLabel = phone ? `📞 ${phone}` : "+ telefone";
    const paidUp = p.pending <= 0.0001;
    const status = p.count === 0
      ? `<div class="pay-status">— sem lançamentos</div>`
      : paidUp
        ? `<div class="pay-status paid">✓ Pago</div>`
        : `<div class="pay-status pending">A receber ${fmt(p.pending)}</div>`;
    return `
      <div class="person-card ${isActive ? "active" : ""} ${p.count > 0 && paidUp ? "is-paid" : ""}" data-person="${p.name}">
        <div class="name">${p.name}</div>
        <div class="amount">${fmt(p.total)}</div>
        ${status}
        <div class="count">${p.count} lançamento${p.count !== 1 ? "s" : ""}</div>
        <div class="phone ${phone ? "" : "muted"}" data-phone="${p.name}">${phoneLabel}</div>
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".person-card").forEach(card => {
    card.addEventListener("click", () => toggleFilter(card.dataset.person));
  });

  grid.querySelectorAll("[data-phone]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();           // não dispara o filtro do card
      setPhone(el.dataset.phone);
    });
  });
}

function toggleFilter(name) {
  if (activeFilter && activeFilter.toLowerCase() === name.toLowerCase()) {
    activeFilter = null;
  } else {
    activeFilter = name;
    openModal(name);
  }
  render();
}

function renderTable() {
  const search   = document.getElementById("searchInput").value.toLowerCase();
  const tbody    = document.getElementById("tableBody");
  const emptyMsg = document.getElementById("emptyTableMsg");

  let filtered = entries.filter(e => {
    const matchFilter = !activeFilter || e.name.toLowerCase() === activeFilter.toLowerCase();
    const matchSearch = !search || e.name.toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  filtered.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === "date")   { va = new Date(va); vb = new Date(vb); }
    if (sortKey === "amount" || sortKey === "quantity") { va = Number(va); vb = Number(vb); }
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });

  ["name", "product", "quantity", "amount", "date", "paid"].forEach(k => {
    const th = document.getElementById("th-" + k);
    if (!th) return;
    th.classList.toggle("sorted", sortKey === k);
    th.querySelector(".sort-icon").textContent = sortKey === k ? (sortDir === 1 ? "↑" : "↓") : "↕";
  });

  if (!filtered.length) {
    tbody.innerHTML = "";
    emptyMsg.style.display = "block";
    return;
  }

  emptyMsg.style.display = "none";
  tbody.innerHTML = filtered.map(e => `
    <tr>
      <td><span class="badge">${e.name}</span></td>
      <td>${e.product || "—"}</td>
      <td>${e.quantity}</td>
      <td class="amount-cell">${fmt(e.amount)}</td>
      <td class="date-cell">${fmtDate(e.date)}</td>
      <td>
        <button class="status-pill ${e.paid ? "paid" : "pending"}" data-paid-id="${e.id}" data-paid="${e.paid ? 1 : 0}" title="Clique para alternar">
          ${e.paid ? "✓ Pago" : "● Pendente"}
        </button>
      </td>
      <td><button class="btn-danger" data-id="${e.id}">✕</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-paid-id]").forEach(btn => {
    btn.addEventListener("click", () => togglePaid(Number(btn.dataset.paidId), btn.dataset.paid !== "1"));
  });

  tbody.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(Number(btn.dataset.id)));
  });
}

function updateSuggestions() {
  const names = allPeople().sort((a, b) => a.localeCompare(b, "pt-BR"));
  document.getElementById("namesSuggestions").innerHTML = names.map(n => `<option value="${n}">`).join("");
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(personName) {
  modalPerson = personName;
  const list  = entries.filter(e => e.name.toLowerCase() === personName.toLowerCase())
                       .sort((a, b) => new Date(b.date) - new Date(a.date));
  const total   = list.reduce((s, e) => s + e.amount, 0);
  const pending = list.reduce((s, e) => s + (e.paid ? 0 : e.amount), 0);
  const allPaid = list.length > 0 && pending <= 0.0001;

  const phone = phones[personName.toLowerCase()] || "";
  document.getElementById("modalTitle").textContent = phone ? `${personName} — 📞 ${phone}` : personName;
  document.getElementById("modalTotal").innerHTML =
    `${fmt(total)}` + (
      !list.length ? ""
      : pending > 0.0001 ? ` <span class="modal-pending">(a receber ${fmt(pending)})</span>`
      : ` <span class="modal-paid-tag">✓ quitado</span>`
    );

  const ul = document.getElementById("modalList");
  ul.innerHTML = list.map(e => `
    <li class="${e.paid ? "li-paid" : ""}">
      <div>
        <div>${e.quantity} un. de ${e.product || "—"}</div>
        <div class="desc">${fmtDate(e.date)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <strong style="color:var(--success)">${fmt(e.amount)}</strong>
        <button class="status-pill ${e.paid ? "paid" : "pending"}" data-paid-id="${e.id}" data-paid="${e.paid ? 1 : 0}" title="Clique para alternar">
          ${e.paid ? "✓ Pago" : "● Pendente"}
        </button>
        <button class="btn-danger" data-id="${e.id}">✕</button>
      </div>
    </li>
  `).join("") || '<li style="color:var(--text-muted);font-size:0.88rem;">Sem lançamentos.</li>';

  ul.querySelectorAll("[data-paid-id]").forEach(btn => {
    btn.addEventListener("click", () => togglePaid(Number(btn.dataset.paidId), btn.dataset.paid !== "1"));
  });

  ul.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(Number(btn.dataset.id)));
  });

  const togglePaidBtn = document.getElementById("btnTogglePaidAll");
  togglePaidBtn.textContent = allPaid ? "↺ Marcar tudo pendente" : "✓ Marcar tudo pago";
  togglePaidBtn.dataset.target = allPaid ? "0" : "1";
  togglePaidBtn.disabled = list.length === 0;
  document.getElementById("btnClearPerson").disabled = list.length === 0;

  document.getElementById("modalOverlay").classList.add("open");
}

function closeModalDirect() {
  document.getElementById("modalOverlay").classList.remove("open");
  modalPerson = null;
}

// ── Exportar / Imprimir ─────────────────────────────────────────────────────────

function exportCSV() {
  if (!entries.length) return alert("Não há lançamentos para exportar.");

  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["Pessoa", "Produto", "Quantidade", "Valor", "Data", "Status"];
  const rows = entries.map(e => [
    esc(e.name),
    esc(e.product || ""),
    e.quantity,
    esc(Number(e.amount).toFixed(2).replace(".", ",")),
    esc(fmtDate(e.date)),
    esc(e.paid ? "Pago" : "Pendente"),
  ].join(";"));

  const csv = "﻿" + [header.join(";"), ...rows].join("\r\n");   // BOM p/ Excel
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lancamentos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function openPrintWindow(title, bodyHtml) {
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" />
    <title>${title}</title>
    <style>
      * { font-family: 'Segoe UI', system-ui, sans-serif; }
      body { color: #1f2937; padding: 28px; }
      h1 { font-size: 1.4rem; margin-bottom: 2px; }
      .sub { color: #6b7280; font-size: 0.85rem; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 10px; }
      th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e6eb; }
      th { text-transform: uppercase; font-size: 0.72rem; color: #6b7280; letter-spacing: 0.5px; }
      tfoot td { font-weight: 700; border-top: 2px solid #1f2937; border-bottom: none; }
      .right { text-align: right; }
      .tag-paid { color: #15803d; font-weight: 700; }
      .tag-pending { color: #dc2626; font-weight: 700; }
      .totals { margin-top: 18px; font-size: 1rem; }
      .totals .pend { color: #dc2626; }
      @media print { body { padding: 0; } }
    </style></head><body>${bodyHtml}
    <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`);
  w.document.close();
}

function printReceipt(name) {
  const list = entries.filter(e => e.name.toLowerCase() === name.toLowerCase())
                      .sort((a, b) => new Date(a.date) - new Date(b.date));
  const total   = list.reduce((s, e) => s + e.amount, 0);
  const pending = list.reduce((s, e) => s + (e.paid ? 0 : e.amount), 0);
  const phone   = phones[name.toLowerCase()] || "";

  const rows = list.map(e => `
    <tr>
      <td>${e.product || "—"}</td>
      <td>${e.quantity}</td>
      <td class="right">${fmt(e.amount)}</td>
      <td>${fmtDate(e.date)}</td>
      <td>${e.paid ? '<span class="tag-paid">Pago</span>' : '<span class="tag-pending">Pendente</span>'}</td>
    </tr>`).join("");

  const body = `
    <h1>Recibo — ${name}</h1>
    <div class="sub">${phone ? "📞 " + phone + " · " : ""}Emitido em ${new Date().toLocaleDateString("pt-BR")}</div>
    <table>
      <thead><tr><th>Produto</th><th>Qtd</th><th class="right">Valor</th><th>Data</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sem lançamentos.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="right">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
    </table>
    <div class="totals">
      ${pending > 0.0001
        ? `<span class="pend"><strong>A pagar: ${fmt(pending)}</strong></span>`
        : `<strong style="color:#15803d">✓ Conta quitada</strong>`}
    </div>`;

  openPrintWindow(`Recibo - ${name}`, body);
}

function printList() {
  if (!entries.length) return alert("Não há lançamentos para imprimir.");

  const list = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  const total   = list.reduce((s, e) => s + e.amount, 0);
  const pending = list.reduce((s, e) => s + (e.paid ? 0 : e.amount), 0);

  const rows = list.map(e => `
    <tr>
      <td>${e.name}</td>
      <td>${e.product || "—"}</td>
      <td>${e.quantity}</td>
      <td class="right">${fmt(e.amount)}</td>
      <td>${fmtDate(e.date)}</td>
      <td>${e.paid ? '<span class="tag-paid">Pago</span>' : '<span class="tag-pending">Pendente</span>'}</td>
    </tr>`).join("");

  const body = `
    <h1>Controle de salgado — Lançamentos</h1>
    <div class="sub">Emitido em ${new Date().toLocaleDateString("pt-BR")} · ${list.length} lançamento(s)</div>
    <table>
      <thead><tr><th>Pessoa</th><th>Produto</th><th>Qtd</th><th class="right">Valor</th><th>Data</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="right">${fmt(total)}</td><td colspan="2"></td></tr></tfoot>
    </table>
    <div class="totals"><span class="pend"><strong>A receber: ${fmt(pending)}</strong></span></div>`;

  openPrintWindow("Lançamentos", body);
}

// ── Backup ────────────────────────────────────────────────────────────────────

async function restoreBackup(file) {
  if (!confirm("Restaurar este backup vai SUBSTITUIR todos os dados atuais. Continuar?")) return;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/restore", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Erro ao restaurar.");
  alert(data.message);
  closeModalDirect();
  activeFilter = null;
  await loadEntries();
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.getElementById("btnAdd").addEventListener("click", addEntry);

document.getElementById("btnExportCsv").addEventListener("click", exportCSV);
document.getElementById("btnPrintList").addEventListener("click", printList);
document.getElementById("btnReceipt").addEventListener("click", () => { if (modalPerson) printReceipt(modalPerson); });

document.getElementById("btnRestore").addEventListener("click", () => document.getElementById("restoreFile").click());
document.getElementById("restoreFile").addEventListener("change", e => {
  if (e.target.files[0]) restoreBackup(e.target.files[0]);
  e.target.value = "";
});

document.getElementById("btnCloseModal").addEventListener("click", closeModalDirect);
document.getElementById("btnClearPerson").addEventListener("click", clearPerson);
document.getElementById("btnDeletePerson").addEventListener("click", deletePerson);
document.getElementById("btnClearPaid").addEventListener("click", clearPaid);

document.getElementById("btnWhatsapp").addEventListener("click", () => {
  if (modalPerson) sendWhatsapp(modalPerson);
});

document.getElementById("btnTogglePaidAll").addEventListener("click", e => {
  if (modalPerson) setPersonPaid(modalPerson, e.currentTarget.dataset.target === "1");
});

document.getElementById("modalOverlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modalOverlay")) closeModalDirect();
});

document.getElementById("btnClearFilter").addEventListener("click", () => {
  activeFilter = null;
  document.getElementById("searchInput").value = "";
  render();
});

document.getElementById("searchInput").addEventListener("input", renderTable);

document.querySelectorAll("thead th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortDir *= -1;
    else { sortKey = key; sortDir = key === "date" ? -1 : 1; }
    renderTable();
  });
});

document.getElementById("inputQty").addEventListener("keydown",  e => { if (e.key === "Enter") addEntry(); });
document.getElementById("inputName").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("inputQty").focus(); });

document.getElementById("inputProduct").addEventListener("change", updateValueDisplay);
document.getElementById("inputQty").addEventListener("input", updateValueDisplay);

// ── Init ──────────────────────────────────────────────────────────────────────
initDate();
loadEntries();
