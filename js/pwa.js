/* PWA: registro del service worker, actualizaciones e instalacion.
   Se carga aparte de app.js para no mezclar con la logica de negocio. */

(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;

  let recargando = false;

  // Cuando el SW nuevo toma el control, recargamos una sola vez para
  // estrenar la version. El guard evita el bucle de recargas.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  // La version es la del SW (unica fuente de verdad). El SW responde
  // GET_VERSION y aqui lo mostramos.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.tipo === "VERSION") mostrarVersion(e.data.version);
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((reg) => {
      // Si ya hay un SW esperando (de una visita anterior), avisamos ya.
      if (reg.waiting && navigator.serviceWorker.controller) avisarActualizacion(reg);

      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          // "installed" + ya habia un controlador = es una ACTUALIZACION,
          // no la primera instalacion.
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
            avisarActualizacion(reg);
          }
        });
      });

      // Busca versiones nuevas al volver a la pestaña y cada 30 min, para
      // que una app instalada y siempre abierta no se quede rezagada.
      const revisar = () => reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") revisar();
      });
      setInterval(revisar, 30 * 60 * 1000);

      pedirVersion();
    }).catch((err) => console.warn("No se pudo registrar el service worker:", err));
  });

  function pedirVersion() {
    navigator.serviceWorker.ready.then((reg) => {
      const sw = navigator.serviceWorker.controller || reg.active;
      if (sw) sw.postMessage({ tipo: "GET_VERSION" });
    });
  }

  function mostrarVersion(v) {
    document.querySelectorAll("[data-version]").forEach((el) => {
      el.textContent = "v" + v;
    });
  }

  /* ----------------------------- actualizar ---------------------------- */

  let bannerVisible = false;

  function avisarActualizacion(reg) {
    if (bannerVisible) return;
    bannerVisible = true;

    const banner = document.createElement("div");
    banner.className = "pwa-banner";
    banner.setAttribute("role", "alert");

    const texto = document.createElement("span");
    texto.textContent = "Hay una nueva versión disponible.";

    const btn = document.createElement("button");
    btn.className = "btn btn-primary btn-mini";
    btn.textContent = "Actualizar";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Actualizando…";
      // El SW que espera hace skipWaiting; luego 'controllerchange' recarga.
      const esperando = reg.waiting;
      if (esperando) esperando.postMessage({ tipo: "SKIP_WAITING" });
      else location.reload();
    });

    const cerrar = document.createElement("button");
    cerrar.className = "pwa-banner-x";
    cerrar.setAttribute("aria-label", "Ahora no");
    cerrar.textContent = "✕";
    cerrar.addEventListener("click", () => {
      banner.remove();
      bannerVisible = false;
    });

    banner.append(texto, btn, cerrar);
    document.body.appendChild(banner);
  }

  /* ------------------------------ instalar ----------------------------- */

  let promptInstalar = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();          // no mostramos el mini-infobar del navegador
    promptInstalar = e;
    const btn = document.getElementById("btnInstalar");
    if (btn) btn.hidden = false;
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btnInstalar");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      if (!promptInstalar) return;
      promptInstalar.prompt();
      await promptInstalar.userChoice;
      promptInstalar = null;
      btn.hidden = true;
    });
  });

  window.addEventListener("appinstalled", () => {
    promptInstalar = null;
    const btn = document.getElementById("btnInstalar");
    if (btn) btn.hidden = true;
  });
})();
