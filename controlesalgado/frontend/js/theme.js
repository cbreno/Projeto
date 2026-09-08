// Tema claro/escuro compartilhado por todas as páginas.
// Carregado no <head> para aplicar o tema antes da pintura (sem flash).

(function () {
  const KEY = "tema";

  function getTheme() {
    return localStorage.getItem(KEY) || "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function updateButton(theme) {
    const btn = document.getElementById("btnTheme");
    if (!btn) return;
    const dark = theme === "dark";
    btn.textContent = dark ? "☀️" : "🌙";
    btn.title = dark ? "Mudar para tema claro" : "Mudar para tema escuro";
    btn.setAttribute("aria-label", btn.title);
  }

  function toggle() {
    const next = getTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, next);
    applyTheme(next);
    updateButton(next);
  }

  // Aplica imediatamente (evita flash)
  applyTheme(getTheme());

  // Conecta o botão quando o DOM estiver pronto
  document.addEventListener("DOMContentLoaded", () => {
    updateButton(getTheme());
    const btn = document.getElementById("btnTheme");
    if (btn) btn.addEventListener("click", toggle);
  });
})();
