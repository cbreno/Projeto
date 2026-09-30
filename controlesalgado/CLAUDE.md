# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Controle de salgado** — a Flask web app to record salgado (snack) sales per person, track who has paid, manage a product catalog, log purchases/expenses, and view a sales dashboard. UI is entirely in Portuguese; currency is BRL.

## Running

```bash
pip install -r requirements.txt   # only dependency is Flask
python app.py                     # http://localhost:5000, debug mode on
```

There is no build step, no bundler, and no automated test suite. The frontend is plain HTML/CSS/vanilla JS served directly by Flask. To smoke-test backend changes without a browser, use the Flask test client:

```bash
python -c "import app; c=app.app.test_client(); print(c.get('/api/entries').get_json())"
```

## Architecture

Multi-page app: a Flask JSON REST API backend ([app.py](app.py)) + a thin DB layer ([database.py](database.py)) serving four self-contained static pages. Each HTML page has exactly one matching JS file; there is no shared app framework — only [frontend/js/theme.js](frontend/js/theme.js) is loaded by every page.

| Page | JS | Purpose |
|------|----|---------|
| [frontend/index.html](frontend/index.html) | [app.js](frontend/js/app.js) | Main: record sales, per-person panel, payments, WhatsApp, CSV/print, backup |
| [frontend/produtos.html](frontend/produtos.html) | [produtos.js](frontend/js/produtos.js) | Product catalog CRUD (price + profit per unit) |
| [frontend/compras.html](frontend/compras.html) | [compras.js](frontend/js/compras.js) | Free-form expense log (independent of the catalog) |
| [frontend/dashboard.html](frontend/dashboard.html) | [dashboard.js](frontend/js/dashboard.js) | KPIs, SVG charts, period filter, monthly closing, ranking |

All pages share [frontend/css/style.css](frontend/css/style.css).

### REST API

| Method | Route | Notes |
|--------|-------|-------|
| GET/POST | `/api/entries` | POST needs `name`, `product_id`, `quantity`, optional `date` |
| DELETE | `/api/entries/<id>` | |
| PUT | `/api/entries/<id>/paid` | body `{paid: bool}` |
| DELETE | `/api/entries/paid` | "Zerar pagos": wipes every paid entry, keeps people registered |
| DELETE / PUT | `/api/entries/person/<name>` , `/api/entries/person/<name>/paid` | bulk by person; DELETE = "zerar" (wipes entries, keeps the person registered) |
| GET/POST/PUT/DELETE | `/api/products` , `/api/products/<id>` | `name`, `price`, `profit`, `active` |
| GET/POST/DELETE | `/api/purchases` , `/api/purchases/<id>` | `product`, `amount`, `date` |
| GET/POST | `/api/people` | POST needs `name`; registers a person with no entries |
| DELETE | `/api/people/<name>` | removes the person **and** their entries ("excluir pessoa") |
| PUT | `/api/people/<name>/phone` | phones matched to entries case-insensitively |
| GET | `/api/backup` | downloads `cobrancas.db` |
| POST | `/api/restore` | multipart `file`; validates the `SQLite format 3` header before overwriting |

### Cross-cutting concepts (read these before changing related code)

- **Product price/profit are snapshotted onto each entry.** When an entry is created, the backend copies the product's `name`, `price` → `unit_price`, and `profit` → `unit_profit` into the `entries` row, and computes `amount = quantity * unit_price`. Editing or deleting a product therefore never changes historical entries. There is **no global price constant anymore** — everything flows from the catalog. Profit is summed per-entry as `quantity * unit_profit` (with a `4.80` fallback for legacy rows), in both [app.js](frontend/js/app.js) `renderStats` and [dashboard.js](frontend/js/dashboard.js).

- **The `people` table is the person registry, not just a phonebook.** Creating an entry upserts the name into `people` (`db.register_person`), so "Zerar pessoa" can delete every entry without the person vanishing from the panel. The frontend's `allPeople()` in [app.js](frontend/js/app.js) unions `people` with the names found in entries, and `renderPanel` seeds a zeroed card for each. Only `DELETE /api/people/<name>` ("Excluir pessoa") actually removes someone.

- **Self-migrating SQLite.** `init_db()` in [database.py](database.py) creates tables `IF NOT EXISTS`, then uses `PRAGMA table_info` + `ALTER TABLE` to add columns to old databases (`quantity`, `paid`, `product`, `unit_price`, `unit_profit`), backfills legacy rows, and seeds a default `Salgado` product (R$ 10 / R$ 4,80 profit). Any new column must follow this same add-then-backfill pattern so existing `cobrancas.db` files keep working.

- **Tables:** `entries(id, name, product, quantity, unit_price, unit_profit, amount, date, paid)`, `products(id, name UNIQUE NOCASE, price, profit, active)`, `purchases(id, product, amount, date)`, `people(name PK NOCASE, phone)`. `date` is an ISO timestamp.

- **Dates are stored as naive UTC** (`datetime.utcnow().isoformat()`, no `Z`). The frontend's `dayKey`/`fmtDate` append `Z` when missing and shift by the local timezone offset to derive the local calendar day — used for day/month grouping in the dashboard. Preserve this convention when adding date logic. (`utcnow` is deprecated but kept for consistency across the codebase.)

- **No client-side libraries.** Charts are hand-rolled inline SVG (`renderBarChart`/`renderGroupedChart` in [dashboard.js](frontend/js/dashboard.js)); CSV export, printable receipts/reports, and "save as PDF" are generated client-side (`exportCSV`, `openPrintWindow` → `window.print()` in [app.js](frontend/js/app.js)). The WhatsApp charge link is built in-browser as a `wa.me` URL, stripping non-digits and prepending `55` (Brazil). Keep new features dependency-free and offline-friendly to match this.

- **Theming.** [theme.js](frontend/js/theme.js) is loaded in each page's `<head>` (before paint, to avoid flash); it sets `data-theme="light|dark"` on `<html>` and persists the choice in `localStorage["tema"]`. The dark palette is a `[data-theme="dark"]` block overriding CSS variables in [style.css](frontend/css/style.css). New colors should be CSS variables so both themes pick them up.
