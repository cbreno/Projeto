const API = "/api/products";

let products = [];
let editingId = null;

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmt(val) {
  return Number(val).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showError(msg) {
  document.getElementById("formError").textContent = msg;
  setTimeout(() => { document.getElementById("formError").textContent = ""; }, 3000);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function loadProducts() {
  products = await (await fetch(API)).json();
  render();
}

async function saveProduct() {
  const name   = document.getElementById("inputName").value.trim();
  const price  = parseFloat(document.getElementById("inputPrice").value);
  const profit = parseFloat(document.getElementById("inputProfit").value);

  if (!name)                       return showError("Informe o nome do produto.");
  if (isNaN(price) || price < 0)   return showError("Informe um preço válido.");
  if (isNaN(profit) || profit < 0) return showError("Informe um lucro válido.");

  const btn = document.getElementById("btnSave");
  btn.disabled = true;

  const editing = editingId !== null;
  const url = editing ? `${API}/${editingId}` : API;
  const res = await fetch(url, {
    method: editing ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, price, profit, active: true }),
  });

  btn.disabled = false;

  if (!res.ok) {
    const err = await res.json();
    return showError(err.error || "Erro ao salvar.");
  }

  resetForm();
  await loadProducts();
}

async function deleteProduct(id) {
  if (!confirm("Remover este produto? (lançamentos antigos não são afetados)")) return;
  await fetch(`${API}/${id}`, { method: "DELETE" });
  if (editingId === id) resetForm();
  await loadProducts();
}

async function toggleActive(p) {
  await fetch(`${API}/${p.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: p.name, price: p.price, profit: p.profit, active: !p.active }),
  });
  await loadProducts();
}

// ── Edição ────────────────────────────────────────────────────────────────────

function startEdit(p) {
  editingId = p.id;
  document.getElementById("inputName").value   = p.name;
  document.getElementById("inputPrice").value  = p.price;
  document.getElementById("inputProfit").value = p.profit;
  document.getElementById("formTitle").textContent = `Editando: ${p.name}`;
  document.getElementById("btnSave").textContent = "Salvar alterações";
  document.getElementById("btnCancelEdit").style.display = "";
  document.getElementById("inputName").focus();
}

function resetForm() {
  editingId = null;
  document.getElementById("inputName").value   = "";
  document.getElementById("inputPrice").value  = "";
  document.getElementById("inputProfit").value = "";
  document.getElementById("formTitle").textContent = "Novo Produto";
  document.getElementById("btnSave").textContent = "+ Adicionar";
  document.getElementById("btnCancelEdit").style.display = "none";
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const tbody = document.getElementById("tableBody");
  const empty = document.getElementById("emptyMsg");

  if (!products.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = products.map(p => `
    <tr class="${p.active ? "" : "row-inactive"}">
      <td><span class="badge">${p.name}</span></td>
      <td class="amount-cell">${fmt(p.price)}</td>
      <td>${fmt(p.profit)}</td>
      <td>
        <button class="status-pill ${p.active ? "paid" : "pending"}" data-toggle="${p.id}" title="Clique para ativar/desativar">
          ${p.active ? "✓ Ativo" : "● Inativo"}
        </button>
      </td>
      <td style="white-space:nowrap;">
        <button class="btn-outline btn-sm" data-edit="${p.id}">✏️ Editar</button>
        <button class="btn-danger" data-del="${p.id}">✕</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-edit]").forEach(b =>
    b.addEventListener("click", () => startEdit(products.find(p => p.id === Number(b.dataset.edit)))));
  tbody.querySelectorAll("[data-del]").forEach(b =>
    b.addEventListener("click", () => deleteProduct(Number(b.dataset.del))));
  tbody.querySelectorAll("[data-toggle]").forEach(b =>
    b.addEventListener("click", () => toggleActive(products.find(p => p.id === Number(b.dataset.toggle)))));
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.getElementById("btnSave").addEventListener("click", saveProduct);
document.getElementById("btnCancelEdit").addEventListener("click", resetForm);
document.getElementById("inputProfit").addEventListener("keydown", e => { if (e.key === "Enter") saveProduct(); });

// ── Init ──────────────────────────────────────────────────────────────────────
loadProducts();
