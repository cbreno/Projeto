const ENTRIES_API   = "/api/entries";
const PURCHASES_API = "/api/purchases";

const FALLBACK_PROFIT = 4.80;   // lucro padrão p/ lançamentos antigos sem registro

const entryProfit = e => (e.quantity || 0) * (e.unit_profit ?? FALLBACK_PROFIT);

let allEntries   = [];
let allPurchases = [];
let entries   = [];   // recorte do período aplicado
let purchases = [];   // recorte do período aplicado
let period = { mode: "all", from: null, to: null };

const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                   "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ── Utilitários ───────────────────────────────────────────────────────────────

function fmt(val) {
  return Number(val).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCompact(val) {
  const n = Number(val);
  if (Math.abs(n) >= 1000) return "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
  return fmt(n);
}

function dayKey(iso) {
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);           // YYYY-MM-DD (local)
}

function fmtDay(key) {
  return key.slice(8, 10) + "/" + key.slice(5, 7);
}

function monthKey(iso) {
  return dayKey(iso).slice(0, 7);          // YYYY-MM
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS_PT[Number(m) - 1]} / ${y}`;
}

// ── Carregamento ────────────────────────────────────────────────────────────────

async function loadAll() {
  const [eRes, pRes] = await Promise.all([fetch(ENTRIES_API), fetch(PURCHASES_API)]);
  allEntries   = await eRes.json();
  allPurchases = await pRes.json();
  applyPeriod();
}

// ── Filtro de período ───────────────────────────────────────────────────────────

function inPeriod(iso) {
  const day = dayKey(iso);
  if (period.mode === "range") {
    if (period.from && day < period.from) return false;
    if (period.to   && day > period.to)   return false;
    return true;
  }
  if (period.mode === "all") return true;
  // modo "7" ou "30": últimos N dias
  const n = Number(period.mode);
  const limit = new Date();
  limit.setDate(limit.getDate() - (n - 1));
  return dayKey(limit.toISOString()) <= day;
}

function applyPeriod() {
  entries   = allEntries.filter(e => inPeriod(e.date));
  purchases = allPurchases.filter(p => inPeriod(p.date));
  updatePeriodLabel();
  render();
}

function updatePeriodLabel() {
  const el = document.getElementById("periodLabel");
  let txt;
  if (period.mode === "range") {
    const f = period.from ? period.from.split("-").reverse().join("/") : "início";
    const t = period.to   ? period.to.split("-").reverse().join("/")   : "hoje";
    txt = `Período: ${f} até ${t}`;
  } else if (period.mode === "all") {
    txt = "Período: todos os lançamentos";
  } else {
    txt = `Período: últimos ${period.mode} dias`;
  }
  el.textContent = `${txt} · ${entries.length} lançamento(s), ${purchases.length} compra(s)`;
}

// ── Agregações ──────────────────────────────────────────────────────────────────

function salesByDay() {
  const map = {};
  entries.forEach(e => {
    const k = dayKey(e.date);
    if (!map[k]) map[k] = { qty: 0, value: 0, profit: 0 };
    map[k].qty    += e.quantity || 0;
    map[k].value  += e.amount;
    map[k].profit += entryProfit(e);
  });
  return map;
}

function expenseByDay() {
  const map = {};
  purchases.forEach(p => {
    const k = dayKey(p.date);
    map[k] = (map[k] || 0) + p.amount;
  });
  return map;
}

function toSortedArray(map, keyName) {
  return Object.keys(map).sort().map(k => ({ day: k, [keyName]: map[k] }));
}

// ── KPIs ────────────────────────────────────────────────────────────────────────

function renderKpis() {
  const totalSales  = entries.reduce((s, e) => s + e.amount, 0);
  const totalQty    = entries.reduce((s, e) => s + (e.quantity || 0), 0);
  const grossProfit = entries.reduce((s, e) => s + entryProfit(e), 0);
  const totalExpense = purchases.reduce((s, p) => s + p.amount, 0);
  const netProfit   = grossProfit - totalExpense;
  const people      = new Set(entries.map(e => e.name.toLowerCase())).size;
  const ticket      = entries.length ? totalSales / entries.length : 0;

  const days = Object.keys(salesByDay());
  const avgDay = days.length ? totalSales / days.length : 0;

  const kpis = [
    { label: "Faturamento",   value: fmt(totalSales),  cls: "green" },
    { label: "Qtd. vendida",  value: String(totalQty), cls: "blue"  },
    { label: "Lucro bruto",   value: fmt(grossProfit), cls: "green" },
    { label: "Total gasto",   value: fmt(totalExpense), cls: "red"  },
    { label: "Lucro líquido", value: fmt(netProfit),   cls: netProfit >= 0 ? "green" : "red" },
    { label: "Ticket médio",  value: fmt(ticket),      cls: "blue"  },
    { label: "Média / dia",   value: fmt(avgDay),      cls: "green" },
    { label: "Clientes",      value: String(people),   cls: "blue"  },
  ];

  document.getElementById("kpiGrid").innerHTML = kpis.map(k => `
    <div class="stat">
      <div class="stat-label">${k.label}</div>
      <div class="stat-value ${k.cls}">${k.value}</div>
    </div>
  `).join("");
}

// ── Gráfico de barras (1 série) ───────────────────────────────────────────────────

function renderBarChart(containerId, data, valueKey, color, fmtValue) {
  const el = document.getElementById(containerId);

  if (!data.length) {
    el.innerHTML = `<svg viewBox="0 0 600 60"><text class="empty" x="300" y="35" text-anchor="middle">Sem dados ainda.</text></svg>`;
    return;
  }

  const W = 600, H = 220, padL = 16, padR = 16, padTop = 24, padBottom = 36;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const max = Math.max(...data.map(d => d[valueKey])) || 1;

  const slot = plotW / data.length;
  const barW = Math.min(48, slot * 0.6);

  const bars = data.map((d, i) => {
    const h = (d[valueKey] / max) * plotH;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = padTop + (plotH - h);
    return `
      <g>
        <rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}">
          <title>${fmtDay(d.day)}: ${fmtValue(d[valueKey])}</title>
        </rect>
        <text class="bar-label" x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${fmtValue(d[valueKey])}</text>
        <text class="day-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle">${fmtDay(d.day)}</text>
      </g>`;
  }).join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <line class="axis-line" x1="${padL}" y1="${padTop + plotH}" x2="${W - padR}" y2="${padTop + plotH}" />
      ${bars}
    </svg>`;
}

// ── Gráfico de barras agrupadas (2 séries) ─────────────────────────────────────────

function renderGroupedChart(containerId, days, seriesA, seriesB, colorA, colorB) {
  const el = document.getElementById(containerId);

  if (!days.length) {
    el.innerHTML = `<svg viewBox="0 0 600 60"><text class="empty" x="300" y="35" text-anchor="middle">Sem dados ainda.</text></svg>`;
    return;
  }

  const W = 600, H = 220, padL = 16, padR = 16, padTop = 24, padBottom = 36;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const max = Math.max(1, ...days.map(d => Math.max(seriesA[d] || 0, seriesB[d] || 0)));

  const slot = plotW / days.length;
  const barW = Math.min(22, slot * 0.32);
  const gap  = 3;

  const groups = days.map((d, i) => {
    const a = seriesA[d] || 0, b = seriesB[d] || 0;
    const ha = (a / max) * plotH, hb = (b / max) * plotH;
    const cx = padL + i * slot + slot / 2;
    const xa = cx - barW - gap / 2;
    const xb = cx + gap / 2;
    return `
      <g>
        <rect class="bar" x="${xa.toFixed(1)}" y="${(padTop + plotH - ha).toFixed(1)}" width="${barW}" height="${ha.toFixed(1)}" rx="3" fill="${colorA}">
          <title>${fmtDay(d)} • Vendas: ${fmt(a)}</title>
        </rect>
        <rect class="bar" x="${xb.toFixed(1)}" y="${(padTop + plotH - hb).toFixed(1)}" width="${barW}" height="${hb.toFixed(1)}" rx="3" fill="${colorB}">
          <title>${fmtDay(d)} • Gastos: ${fmt(b)}</title>
        </rect>
        <text class="day-label" x="${cx.toFixed(1)}" y="${H - 14}" text-anchor="middle">${fmtDay(d)}</text>
      </g>`;
  }).join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <line class="axis-line" x1="${padL}" y1="${padTop + plotH}" x2="${W - padR}" y2="${padTop + plotH}" />
      ${groups}
    </svg>`;
}

// ── Ranking ───────────────────────────────────────────────────────────────────────

function renderRanking() {
  const map = {};
  entries.forEach(e => {
    const key = e.name.toLowerCase();
    if (!map[key]) map[key] = { name: e.name, qty: 0, total: 0 };
    map[key].qty   += e.quantity || 0;
    map[key].total += e.amount;
  });

  const totalSales = entries.reduce((s, e) => s + e.amount, 0) || 1;
  const sorted = Object.values(map).sort((a, b) => b.total - a.total);

  const tbody = document.getElementById("rankingBody");
  const empty = document.getElementById("rankingEmpty");

  if (!sorted.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  const medals = ["🥇", "🥈", "🥉"];
  tbody.innerHTML = sorted.map((p, i) => {
    const pct = (p.total / totalSales) * 100;
    return `
      <tr>
        <td>${medals[i] || (i + 1)}</td>
        <td><span class="badge">${p.name}</span></td>
        <td>${p.qty}</td>
        <td class="amount-cell">${fmt(p.total)}</td>
        <td>
          <div class="share">
            <div class="share-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
            <span class="share-pct">${pct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>`;
  }).join("");
}

// ── Fechamento mensal (todos os meses, independente do filtro) ─────────────────────

function renderMonthly() {
  const map = {};
  allEntries.forEach(e => {
    const k = monthKey(e.date);
    if (!map[k]) map[k] = { qty: 0, sales: 0, profit: 0, expense: 0 };
    map[k].qty    += e.quantity || 0;
    map[k].sales  += e.amount;
    map[k].profit += entryProfit(e);
  });
  allPurchases.forEach(p => {
    const k = monthKey(p.date);
    if (!map[k]) map[k] = { qty: 0, sales: 0, profit: 0, expense: 0 };
    map[k].expense += p.amount;
  });

  const months = Object.keys(map).sort().reverse();   // mais recente primeiro
  const tbody = document.getElementById("monthlyBody");
  const empty = document.getElementById("monthlyEmpty");

  if (!months.length) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = months.map(k => {
    const m = map[k];
    const net = m.profit - m.expense;
    return `
      <tr>
        <td><strong>${monthLabel(k)}</strong></td>
        <td>${m.qty}</td>
        <td class="amount-cell">${fmt(m.sales)}</td>
        <td>${fmt(m.profit)}</td>
        <td style="color:var(--danger)">${fmt(m.expense)}</td>
        <td style="font-weight:700;color:${net >= 0 ? "var(--success-deep)" : "var(--danger)"}">${fmt(net)}</td>
      </tr>`;
  }).join("");
}

// ── Render ──────────────────────────────────────────────────────────────────────

function render() {
  renderKpis();

  const sales   = salesByDay();
  const expense = expenseByDay();

  renderBarChart("chartQty",    toSortedArray(Object.fromEntries(Object.entries(sales).map(([k, v]) => [k, v.qty])),    "qty"),    "qty",    "var(--accent)",  v => String(v));
  renderBarChart("chartValue",  toSortedArray(Object.fromEntries(Object.entries(sales).map(([k, v]) => [k, v.value])),  "value"),  "value",  "var(--success)", v => fmtCompact(v));
  renderBarChart("chartProfit", toSortedArray(Object.fromEntries(Object.entries(sales).map(([k, v]) => [k, v.profit])), "profit"), "profit", "#a78bfa",        v => fmtCompact(v));

  const allDays = [...new Set([...Object.keys(sales), ...Object.keys(expense)])].sort();
  const salesValue = Object.fromEntries(Object.entries(sales).map(([k, v]) => [k, v.value]));
  renderGroupedChart("chartSalesExpense", allDays, salesValue, expense, "var(--success)", "var(--danger)");

  renderRanking();
  renderMonthly();
}

// ── Controles do filtro de período ───────────────────────────────────────────────

function setPreset(mode, btn) {
  period = { mode, from: null, to: null };
  document.querySelectorAll(".period-btn").forEach(b => b.classList.toggle("active", b === btn));
  document.getElementById("periodFrom").value = "";
  document.getElementById("periodTo").value = "";
  applyPeriod();
}

document.querySelectorAll(".period-btn").forEach(btn => {
  btn.addEventListener("click", () => setPreset(btn.dataset.period, btn));
});

document.getElementById("periodApply").addEventListener("click", () => {
  const from = document.getElementById("periodFrom").value;
  const to   = document.getElementById("periodTo").value;
  if (!from && !to) return;
  period = { mode: "range", from: from || null, to: to || null };
  document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
  applyPeriod();
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadAll();
