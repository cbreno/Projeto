const API = "/api/purchases";

let purchases = [];

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmt(val) {
  return Number(val).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(iso) {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function setDateToday() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  document.getElementById("inputDate").value = local.toISOString().slice(0, 10);
}

function showError(msg) {
  document.getElementById("formError").textContent = msg;
  setTimeout(() => { document.getElementById("formError").textContent = ""; }, 3000);
}

// ── API ───────────────────────────────────────────────────────────────────────

async function loadPurchases() {
  purchases = await (await fetch(API)).json();
  render();
}

async function addPurchase() {
  const product = document.getElementById("inputProduct").value.trim();
  const amount  = parseFloat(document.getElementById("inputAmount").value);
  const date    = document.getElementById("inputDate").value;

  if (!product)                  return showError("Informe o produto.");
  if (!amount || amount <= 0)    return showError("Informe um valor válido.");

  const btn = document.getElementById("btnAdd");
  btn.disabled = true;

  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product, amount, date }),
  });

  btn.disabled = false;

  if (!res.ok) {
    const err = await res.json();
    return showError(err.error || "Erro ao adicionar.");
  }

  document.getElementById("inputProduct").value = "";
  document.getElementById("inputAmount").value  = "";
  setDateToday();
  await loadPurchases();
}

async function deletePurchase(id) {
  if (!confirm("Remover esta compra?")) return;
  await fetch(`${API}/${id}`, { method: "DELETE" });
  await loadPurchases();
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const total = purchases.reduce((s, p) => s + p.amount, 0);
  document.getElementById("statTotal").textContent = fmt(total);
  document.getElementById("statCount").textContent = purchases.length;

  const tbody    = document.getElementById("tableBody");
  const emptyMsg = document.getElementById("emptyTableMsg");

  if (!purchases.length) {
    tbody.innerHTML = "";
    emptyMsg.style.display = "block";
    return;
  }

  emptyMsg.style.display = "none";
  tbody.innerHTML = purchases.map(p => `
    <tr>
      <td><span class="badge">${p.product}</span></td>
      <td class="amount-cell">${fmt(p.amount)}</td>
      <td class="date-cell">${fmtDate(p.date)}</td>
      <td><button class="btn-danger" data-id="${p.id}">✕</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => deletePurchase(Number(btn.dataset.id)));
  });
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.getElementById("btnAdd").addEventListener("click", addPurchase);
document.getElementById("inputProduct").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("inputAmount").focus(); });
document.getElementById("inputAmount").addEventListener("keydown",  e => { if (e.key === "Enter") addPurchase(); });

// ── Init ──────────────────────────────────────────────────────────────────────
setDateToday();
loadPurchases();
