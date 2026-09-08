from flask import Flask, jsonify, request, send_file
from datetime import datetime
import sqlite3
import database as db

app = Flask(__name__, static_folder="frontend", static_url_path="")
db.init_db()


# Serve o front end
@app.route("/")
def index():
    return app.send_static_file("index.html")


# ── API ────────────────────────────────────────────────────────────────────────

@app.route("/api/entries", methods=["GET"])
def list_entries():
    return jsonify(db.get_all())


@app.route("/api/entries", methods=["POST"])
def create_entry():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    try:
        quantity = int(data.get("quantity", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Quantidade inválida."}), 400

    if not name:
        return jsonify({"error": "Nome é obrigatório."}), 400
    if quantity < 1:
        return jsonify({"error": "Quantidade deve ser pelo menos 1."}), 400

    product = db.get_product(data.get("product_id"))
    if not product:
        return jsonify({"error": "Selecione um produto válido."}), 400

    # Data escolhida (YYYY-MM-DD) combinada com a hora atual; senão, agora.
    now = datetime.utcnow()
    date_str = (data.get("date") or "").strip()
    if date_str:
        try:
            picked = datetime.strptime(date_str, "%Y-%m-%d")
            date_iso = picked.replace(
                hour=now.hour, minute=now.minute, second=now.second, microsecond=now.microsecond
            ).isoformat()
        except ValueError:
            return jsonify({"error": "Data inválida."}), 400
    else:
        date_iso = now.isoformat()

    db.register_person(name)   # mantém a pessoa na lista mesmo se zerar os lançamentos

    amount = quantity * product["price"]
    entry_id = db.insert(
        name, product["name"], quantity, product["price"], product["profit"], amount, date_iso
    )
    return jsonify({"id": entry_id, "message": "Lançamento criado."}), 201


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    db.delete_by_id(entry_id)
    return jsonify({"message": "Lançamento removido."})


@app.route("/api/entries/<int:entry_id>/paid", methods=["PUT"])
def update_entry_paid(entry_id):
    data = request.get_json(silent=True) or {}
    db.set_paid(entry_id, bool(data.get("paid")))
    return jsonify({"message": "Pagamento atualizado."})


@app.route("/api/entries/person/<string:name>/paid", methods=["PUT"])
def update_person_paid(name):
    data = request.get_json(silent=True) or {}
    db.set_person_paid(name, bool(data.get("paid")))
    return jsonify({"message": "Pagamento atualizado."})


@app.route("/api/entries/person/<string:name>", methods=["DELETE"])
def clear_person_entries(name):
    """Zera a pessoa: apaga os lançamentos, mas mantém o cadastro na lista."""
    db.delete_by_person(name)
    db.register_person(name)
    return jsonify({"message": f"Todos os lançamentos de '{name}' removidos."})


# ── Compras (produtos comprados) ─────────────────────────────────────────────────

@app.route("/api/purchases", methods=["GET"])
def list_purchases():
    return jsonify(db.get_purchases())


@app.route("/api/purchases", methods=["POST"])
def create_purchase():
    data = request.get_json(silent=True) or {}
    product = (data.get("product") or "").strip()

    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valor inválido."}), 400

    if not product:
        return jsonify({"error": "Produto é obrigatório."}), 400
    if amount <= 0:
        return jsonify({"error": "Valor deve ser maior que zero."}), 400

    now = datetime.utcnow()
    date_str = (data.get("date") or "").strip()
    if date_str:
        try:
            picked = datetime.strptime(date_str, "%Y-%m-%d")
            date_iso = picked.replace(
                hour=now.hour, minute=now.minute, second=now.second, microsecond=now.microsecond
            ).isoformat()
        except ValueError:
            return jsonify({"error": "Data inválida."}), 400
    else:
        date_iso = now.isoformat()

    purchase_id = db.insert_purchase(product, amount, date_iso)
    return jsonify({"id": purchase_id, "message": "Compra registrada."}), 201


@app.route("/api/purchases/<int:purchase_id>", methods=["DELETE"])
def delete_purchase(purchase_id):
    db.delete_purchase(purchase_id)
    return jsonify({"message": "Compra removida."})


# ── Catálogo de produtos ──────────────────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def list_products():
    active_only = request.args.get("active") == "1"
    return jsonify(db.get_products(active_only=active_only))


def _parse_product_payload(data):
    name = (data.get("name") or "").strip()
    try:
        price = float(data.get("price"))
        profit = float(data.get("profit", 0))
    except (TypeError, ValueError):
        return None, (jsonify({"error": "Preço/lucro inválidos."}), 400)

    if not name:
        return None, (jsonify({"error": "Nome do produto é obrigatório."}), 400)
    if price < 0 or profit < 0:
        return None, (jsonify({"error": "Preço e lucro não podem ser negativos."}), 400)
    return {"name": name, "price": price, "profit": profit}, None


@app.route("/api/products", methods=["POST"])
def create_product():
    payload, err = _parse_product_payload(request.get_json(silent=True) or {})
    if err:
        return err
    try:
        pid = db.insert_product(payload["name"], payload["price"], payload["profit"])
    except sqlite3.IntegrityError:
        return jsonify({"error": "Já existe um produto com esse nome."}), 400
    return jsonify({"id": pid, "message": "Produto criado."}), 201


@app.route("/api/products/<int:product_id>", methods=["PUT"])
def update_product(product_id):
    data = request.get_json(silent=True) or {}
    payload, err = _parse_product_payload(data)
    if err:
        return err
    active = data.get("active", True)
    try:
        db.update_product(product_id, payload["name"], payload["price"], payload["profit"], active)
    except sqlite3.IntegrityError:
        return jsonify({"error": "Já existe um produto com esse nome."}), 400
    return jsonify({"message": "Produto atualizado."})


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
def delete_product(product_id):
    db.delete_product(product_id)
    return jsonify({"message": "Produto removido."})


# ── Telefones por pessoa ─────────────────────────────────────────────────────────

@app.route("/api/people", methods=["GET"])
def list_people():
    return jsonify(db.get_people())


@app.route("/api/people", methods=["POST"])
def create_person():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nome é obrigatório."}), 400
    db.register_person(name)
    return jsonify({"message": "Pessoa cadastrada."}), 201


@app.route("/api/people/<string:name>", methods=["DELETE"])
def delete_person(name):
    """Exclui a pessoa da lista (junto com os lançamentos dela)."""
    db.delete_person(name)
    return jsonify({"message": f"'{name}' removido(a) da lista."})


@app.route("/api/people/<string:name>/phone", methods=["PUT"])
def update_phone(name):
    data = request.get_json(silent=True) or {}
    phone = (data.get("phone") or "").strip()
    db.set_phone(name, phone)
    return jsonify({"message": "Telefone atualizado."})


# ── Backup / Restauração do banco ────────────────────────────────────────────────

@app.route("/api/backup", methods=["GET"])
def backup_db():
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    return send_file(
        db.DB_PATH,
        as_attachment=True,
        download_name=f"cobrancas_{stamp}.db",
        mimetype="application/octet-stream",
    )


@app.route("/api/restore", methods=["POST"])
def restore_db():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "Nenhum arquivo enviado."}), 400

    data = f.read()
    if data[:16] != b"SQLite format 3\x00":
        return jsonify({"error": "Arquivo inválido (não é um banco SQLite)."}), 400

    with open(db.DB_PATH, "wb") as out:
        out.write(data)
    db.init_db()   # garante colunas/migrações no banco restaurado
    return jsonify({"message": "Backup restaurado com sucesso."})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
