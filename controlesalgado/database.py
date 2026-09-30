import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "cobrancas.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                name     TEXT    NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                amount   REAL    NOT NULL,
                date     TEXT    NOT NULL
            )
        """)
        # Migração: adiciona colunas novas em bancos antigos
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(entries)")]
        if "quantity" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1")
        if "paid" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN paid INTEGER NOT NULL DEFAULT 0")
        if "product" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN product TEXT")
        if "unit_price" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN unit_price REAL")
        if "unit_profit" not in cols:
            conn.execute("ALTER TABLE entries ADD COLUMN unit_profit REAL")

        # Backfill de lançamentos antigos (sem produto/preço/lucro)
        conn.execute("UPDATE entries SET product = 'Salgado' WHERE product IS NULL")
        conn.execute(
            "UPDATE entries SET unit_price = CASE WHEN quantity > 0 THEN amount / quantity ELSE 10.0 END "
            "WHERE unit_price IS NULL"
        )
        conn.execute("UPDATE entries SET unit_profit = 4.80 WHERE unit_profit IS NULL")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS people (
                name  TEXT PRIMARY KEY COLLATE NOCASE,
                phone TEXT
            )
        """)
        # Backfill: toda pessoa que já tem lançamento vira cadastro fixo,
        # para não sumir da lista quando os lançamentos forem zerados.
        conn.execute("INSERT OR IGNORE INTO people (name, phone) SELECT DISTINCT name, '' FROM entries")

        conn.execute("""
            CREATE TABLE IF NOT EXISTS purchases (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                product TEXT    NOT NULL,
                amount  REAL    NOT NULL,
                date    TEXT    NOT NULL
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                name   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                price  REAL    NOT NULL,
                profit REAL    NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1
            )
        """)
        # Produto padrão (mantém o comportamento antigo: R$ 10 / lucro R$ 4,80)
        if conn.execute("SELECT COUNT(*) c FROM products").fetchone()["c"] == 0:
            conn.execute("INSERT INTO products (name, price, profit) VALUES ('Salgado', 10.0, 4.80)")


def get_all():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, product, quantity, amount, unit_price, unit_profit, date, paid "
            "FROM entries ORDER BY date DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def insert(name, product, quantity, unit_price, unit_profit, amount, date):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO entries (name, product, quantity, unit_price, unit_profit, amount, date) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, product, quantity, unit_price, unit_profit, amount, date),
        )
        return cur.lastrowid


def delete_by_id(entry_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))


def delete_by_person(name):
    with get_conn() as conn:
        conn.execute("DELETE FROM entries WHERE LOWER(name) = LOWER(?)", (name,))


def delete_paid():
    """Apaga todos os lançamentos pagos; as pessoas continuam cadastradas."""
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO people (name, phone) SELECT DISTINCT name, '' FROM entries WHERE paid = 1")
        return conn.execute("DELETE FROM entries WHERE paid = 1").rowcount


def set_paid(entry_id, paid):
    with get_conn() as conn:
        conn.execute("UPDATE entries SET paid = ? WHERE id = ?", (1 if paid else 0, entry_id))


def set_person_paid(name, paid):
    with get_conn() as conn:
        conn.execute(
            "UPDATE entries SET paid = ? WHERE LOWER(name) = LOWER(?)",
            (1 if paid else 0, name),
        )


# ── Catálogo de produtos ──────────────────────────────────────────────────────────

def get_products(active_only=False):
    with get_conn() as conn:
        q = "SELECT id, name, price, profit, active FROM products"
        if active_only:
            q += " WHERE active = 1"
        q += " ORDER BY name COLLATE NOCASE"
        rows = conn.execute(q).fetchall()
    return [dict(r) for r in rows]


def get_product(product_id):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, price, profit, active FROM products WHERE id = ?", (product_id,)
        ).fetchone()
    return dict(row) if row else None


def insert_product(name, price, profit):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO products (name, price, profit) VALUES (?, ?, ?)",
            (name, price, profit),
        )
        return cur.lastrowid


def update_product(product_id, name, price, profit, active):
    with get_conn() as conn:
        conn.execute(
            "UPDATE products SET name = ?, price = ?, profit = ?, active = ? WHERE id = ?",
            (name, price, profit, 1 if active else 0, product_id),
        )


def delete_product(product_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))


# ── Compras (produtos comprados) ─────────────────────────────────────────────────

def get_purchases():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, product, amount, date FROM purchases ORDER BY date DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def insert_purchase(product, amount, date):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO purchases (product, amount, date) VALUES (?, ?, ?)",
            (product, amount, date),
        )
        return cur.lastrowid


def delete_purchase(purchase_id):
    with get_conn() as conn:
        conn.execute("DELETE FROM purchases WHERE id = ?", (purchase_id,))


# ── Telefones por pessoa ─────────────────────────────────────────────────────────

def get_people():
    with get_conn() as conn:
        rows = conn.execute("SELECT name, phone FROM people ORDER BY name COLLATE NOCASE").fetchall()
    return [dict(r) for r in rows]


def register_person(name):
    """Cadastra a pessoa se ainda não existir (não mexe no telefone já salvo)."""
    with get_conn() as conn:
        conn.execute("INSERT OR IGNORE INTO people (name, phone) VALUES (?, '')", (name,))


def delete_person(name):
    """Remove a pessoa do cadastro e todos os seus lançamentos."""
    with get_conn() as conn:
        conn.execute("DELETE FROM entries WHERE LOWER(name) = LOWER(?)", (name,))
        conn.execute("DELETE FROM people WHERE name = ?", (name,))


def set_phone(name, phone):
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO people (name, phone) VALUES (?, ?) "
            "ON CONFLICT(name) DO UPDATE SET phone = excluded.phone",
            (name, phone),
        )
