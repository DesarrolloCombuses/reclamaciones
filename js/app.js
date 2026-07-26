/* Reclamaciones en contra - login, consulta, seguimiento y auditoria. */

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Campos editables desde el formulario. 'saldo' no esta: lo calcula la base.
// 'observaciones' tampoco: su contenido vive ahora en la bitacora.
const CAMPOS = [
  "estado", "radicado", "fecha_radicado", "plazo_respuesta", "fecha_cierre",
  "fecha_siniestro", "fecha_siniestro_texto", "conductor", "afiliado",
  "placa_afiliado", "reclamante", "correo", "telefono", "placa_tercero",
  "pretensiones", "pagado", "fecha_pago",
];

const NUMERICOS = ["plazo_respuesta", "pretensiones", "pagado"];
const MAYUSCULAS = ["placa_afiliado", "placa_tercero"];

// Un caso cerrado no "lleva abierto" nada: no se le cuenta antiguedad.
const ESTADOS_CERRADOS = ["PAGADO", "OBJETADO"];

const ETIQUETAS = {
  estado: "Estado", radicado: "Radicado", fecha_radicado: "Fecha de radicado",
  plazo_respuesta: "Plazo para respuesta", fecha_cierre: "Fecha de cierre",
  fecha_siniestro: "Fecha del siniestro", fecha_siniestro_texto: "Fecha sin confirmar",
  conductor: "Conductor", afiliado: "Afiliado", placa_afiliado: "Placa afiliado",
  reclamante: "Reclamante", correo: "Correo", telefono: "Teléfono",
  placa_tercero: "Placa tercero", pretensiones: "Pretensiones", pagado: "Pagado",
  fecha_pago: "Fecha de pago", observaciones: "Observaciones",
  archivada: "Archivada", archivada_motivo: "Motivo de archivado", saldo: "Saldo",
};

const ACCIONES = {
  CREACION: "Reclamación creada",
  ARCHIVADO: "Archivada",
  RESTAURADO: "Restaurada",
  EDICION: "Editada",
};

// La auditoria guarda todo como texto: aqui se devuelve a formato legible.
const CAMPOS_DINERO = ["pretensiones", "pagado", "saldo"];
const CAMPOS_FECHA = ["fecha_radicado", "fecha_cierre", "fecha_siniestro", "fecha_pago"];

let reclamaciones = [];
let editandoId = null;
let detalleActual = null;
let orden = { campo: "fecha_siniestro", asc: false };

const $ = (id) => document.getElementById(id);

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
});

/* ------------------------------ utilidades ------------------------------ */

function fmtDinero(v) {
  return v === null || v === undefined || v === "" ? "—" : pesos.format(v);
}

// Las fechas son DATE puros. new Date('2025-02-19') se interpreta como UTC y
// en Colombia (-05) retrocede un dia, asi que se formatea sin pasar por Date.
function fmtFecha(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function fmtMomento(ts) {
  return ts ? new Date(ts).toLocaleString("es-CO", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) : "—";
}

function hoyIso() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}

// Dias entre una fecha ISO y hoy, contados en local para no desfasar por UTC.
function diasDesde(iso) {
  if (!iso) return null;
  const [a, m, d] = iso.split("-").map(Number);
  const then = new Date(a, m - 1, d);
  const hoy = new Date();
  return Math.floor((new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - then) / 86400000);
}

function fmtAntiguedad(dias) {
  if (dias === null) return "";
  if (dias < 0) return "en el futuro";
  if (dias < 31) return `${dias} d`;
  const meses = Math.floor(dias / 30.44);
  if (meses < 12) return `${meses} m`;
  const anios = Math.floor(dias / 365.25);
  const resto = Math.floor((dias % 365.25) / 30.44);
  return resto ? `${anios} a ${resto} m` : `${anios} a`;
}

function fechaSiniestroTexto(r) {
  return fmtFecha(r.fecha_siniestro) || r.fecha_siniestro_texto || "—";
}

// Los valores de la auditoria llegan como texto plano desde Postgres
// ('15632357.00', '2025-10-14', 'true'): hay que devolverlos a formato humano.
function fmtValorAuditoria(campo, valor) {
  if (valor === null || valor === undefined || valor === "") return "vacío";
  if (CAMPOS_DINERO.includes(campo)) return fmtDinero(Number(valor));
  if (CAMPOS_FECHA.includes(campo)) return fmtFecha(valor) || valor;
  if (valor === "true") return "sí";
  if (valor === "false") return "no";
  if (campo === "plazo_respuesta") return `${valor} días`;
  return valor;
}

function estaAbierta(r) {
  return !r.archivada && !ESTADOS_CERRADOS.includes(r.estado);
}

function toast(msg, tipo = "ok") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast toast-${tipo}`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3500);
}

function slugEstado(estado) {
  return estado.toLowerCase().replace(/[^a-z]+/g, "-");
}

function mensajeError(error) {
  const m = (error && error.message) || "Error desconocido";
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(m)) return "La cuenta existe pero el correo no está confirmado.";
  if (/schema cache|does not exist|PGRST205/i.test(m)) {
    return "Falta una tabla en la base. Revisa que se hayan ejecutado los scripts de sql/.";
  }
  if (/row-level security|violates row-level/i.test(m)) {
    return "Tu usuario no tiene permiso para esto. Solo entran las cuentas @combuses.";
  }
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión con Supabase. Revisa tu red.";
  return m;
}

/* -------------------------------- sesion -------------------------------- */

async function iniciarSesion(evento) {
  evento.preventDefault();
  const btn = $("btnEntrar");
  const err = $("loginError");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Entrando…";

  const { error } = await db.auth.signInWithPassword({
    email: $("loginCorreo").value.trim(),
    password: $("loginClave").value,
  });

  btn.disabled = false;
  btn.textContent = "Entrar";
  if (error) {
    err.textContent = mensajeError(error);
    err.hidden = false;
  }
}

async function cerrarSesion() {
  await db.auth.signOut();
}

function mostrarLogin() {
  $("pantallaApp").hidden = true;
  $("pantallaLogin").hidden = false;
  $("formLogin").reset();
  reclamaciones = [];
}

async function mostrarApp(sesion) {
  $("pantallaLogin").hidden = true;
  $("pantallaApp").hidden = false;
  const correo = sesion.user.email || "";
  $("usuarioCorreo").textContent = correo;
  $("usuarioAvatar").textContent = correo.slice(0, 2).toUpperCase();
  await cargar();
}

/* --------------------------------- datos -------------------------------- */

async function cargar() {
  const aviso = $("avisoTabla");
  aviso.hidden = true;
  pintarSkeleton();

  const { data, error } = await db
    .from(TABLA_RECLAMACIONES)
    .select("*")
    .order("fecha_siniestro", { ascending: false, nullsFirst: false });

  if (error) {
    aviso.textContent = mensajeError(error);
    aviso.hidden = false;
    reclamaciones = [];
  } else {
    reclamaciones = data;
    // Sin permiso RLS Supabase no da error: devuelve una lista vacia.
    if (data.length === 0) {
      aviso.textContent =
        "No se ve ninguna reclamación. Si esperabas datos, revisa que tu correo " +
        "sea @combuses y que se hayan cargado los datos en Supabase.";
      aviso.hidden = false;
    }
  }
  pintar();
}

function filtradas() {
  const q = $("buscar").value.trim().toLowerCase();
  const estado = $("filtroEstado").value;
  const verArchivadas = $("verArchivadas").checked;

  const lista = reclamaciones.filter((r) => {
    if (!verArchivadas && r.archivada) return false;
    if (estado && r.estado !== estado) return false;
    if (!q) return true;
    return ["reclamante", "conductor", "afiliado", "placa_afiliado",
            "placa_tercero", "radicado", "correo", "telefono"]
      .some((c) => (r[c] || "").toString().toLowerCase().includes(q));
  });

  const { campo, asc } = orden;
  lista.sort((a, b) => {
    let x = a[campo], y = b[campo];
    if (x === null || x === undefined || x === "") return 1;   // vacios al final
    if (y === null || y === undefined || y === "") return -1;
    if (NUMERICOS.includes(campo) || campo === "saldo") { x = Number(x); y = Number(y); }
    const cmp = x < y ? -1 : x > y ? 1 : 0;
    return asc ? cmp : -cmp;
  });
  return lista;
}

/* -------------------------------- pintado ------------------------------- */

function celda(texto, clase) {
  const td = document.createElement("td");
  td.textContent = texto ?? "—";           // textContent: los datos son texto libre
  if (clase) td.className = clase;
  return td;
}

function celdaSiniestro(r) {
  const td = document.createElement("td");
  const fecha = document.createElement("span");
  fecha.textContent = fechaSiniestroTexto(r);
  if (!r.fecha_siniestro && r.fecha_siniestro_texto) {
    fecha.className = "dato-dudoso";
    fecha.title = "Fecha sin confirmar: en la hoja original venía sin día.";
  }
  td.appendChild(fecha);

  const dias = diasDesde(r.fecha_siniestro);
  if (dias !== null && estaAbierta(r)) {
    const edad = document.createElement("span");
    edad.className = "antiguedad";
    if (dias > 365) edad.classList.add("antiguedad-vieja");
    else if (dias > 180) edad.classList.add("antiguedad-media");
    edad.textContent = fmtAntiguedad(dias);
    edad.title = `Lleva ${dias} días abierta`;
    td.appendChild(edad);
  }
  return td;
}

// Filas fantasma con brillo mientras llegan los datos. 10 columnas.
function pintarSkeleton(filas = 8) {
  const tbody = $("cuerpoTabla");
  tbody.replaceChildren();
  $("sinResultados").hidden = true;
  const anchos = ["70%", "55%", "85%", "60%", "60%", "80%", "70%", "60%", "60%", "40%"];
  for (let i = 0; i < filas; i++) {
    const tr = document.createElement("tr");
    tr.className = "fila-skeleton";
    for (let c = 0; c < 10; c++) {
      const td = document.createElement("td");
      const sk = document.createElement("span");
      sk.className = c === 0 ? "sk sk-chip" : "sk";
      if (c !== 0) sk.style.width = anchos[c];
      // desfase para que el brillo no vaya sincronizado en todas las filas
      sk.style.animationDelay = `${(i * 10 + c * 4) % 100 / 100}s`;
      td.appendChild(sk);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function pintar() {
  const lista = filtradas();
  const tbody = $("cuerpoTabla");
  tbody.replaceChildren();

  for (const r of lista) {
    const tr = document.createElement("tr");
    if (r.archivada) tr.classList.add("fila-archivada");
    tr.tabIndex = 0;
    tr.addEventListener("click", (e) => {
      if (!e.target.closest("button")) abrirDetalle(r);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") abrirDetalle(r);
    });

    const tdEstado = document.createElement("td");
    const chip = document.createElement("span");
    chip.className = `chip chip-${slugEstado(r.estado)}`;
    chip.textContent = ESTADOS_CORTOS[r.estado] || r.estado;
    chip.title = r.estado;
    tdEstado.appendChild(chip);
    if (r.archivada) {
      const arch = document.createElement("span");
      arch.className = "chip chip-archivada";
      arch.textContent = "ARCHIVADA";
      tdEstado.appendChild(arch);
    }
    tr.appendChild(tdEstado);

    tr.appendChild(celdaSiniestro(r));
    tr.appendChild(celda(r.reclamante));
    tr.appendChild(celda(r.placa_afiliado, "placa"));
    tr.appendChild(celda(r.placa_tercero, "placa"));
    tr.appendChild(celda(r.afiliado));
    tr.appendChild(celda(fmtDinero(r.pretensiones), "num"));
    tr.appendChild(celda(fmtDinero(r.pagado), "num"));

    const tdSaldo = celda(Number(r.saldo) ? fmtDinero(r.saldo) : "—", "num");
    if (Number(r.saldo) > 0 && estaAbierta(r)) tdSaldo.classList.add("saldo-pendiente");
    tr.appendChild(tdSaldo);

    const tdAcc = document.createElement("td");
    tdAcc.className = "acciones-col";
    const bVer = document.createElement("button");
    bVer.className = "btn btn-mini";
    bVer.textContent = "Ver";
    bVer.addEventListener("click", () => abrirDetalle(r));
    const bEditar = document.createElement("button");
    bEditar.className = "btn btn-mini";
    bEditar.textContent = "Editar";
    bEditar.addEventListener("click", () => abrirModal(r));
    tdAcc.append(bVer, bEditar);
    tr.appendChild(tdAcc);

    tbody.appendChild(tr);
  }

  $("sinResultados").hidden = lista.length > 0 || reclamaciones.length === 0;
  $("pieConteo").textContent =
    `Mostrando ${lista.length} de ${reclamaciones.length} reclamaciones`;

  pintarTarjetas(lista);
  pintarOrden();
}

function pintarTarjetas(lista) {
  const suma = (c) => lista.reduce((t, r) => t + Number(r[c] || 0), 0);
  const abiertas = lista.filter(estaAbierta);

  const tarjetas = [
    { etiqueta: "Reclamaciones", valor: String(lista.length), filo: "var(--acento)" },
    { etiqueta: "Pretensiones", valor: pesos.format(suma("pretensiones")), filo: "var(--alerta)" },
    { etiqueta: "Pagado", valor: pesos.format(suma("pagado")), filo: "var(--ok)" },
    { etiqueta: `Saldo · ${abiertas.length} sin cerrar`, filo: "var(--peligro)",
      valor: pesos.format(abiertas.reduce((t, r) => t + Math.max(0, Number(r.saldo || 0)), 0)) },
  ];

  const cont = $("tarjetas");
  cont.replaceChildren();
  for (const t of tarjetas) {
    const div = document.createElement("div");
    div.className = "tarjeta";
    div.style.setProperty("--filo", t.filo);
    const v = document.createElement("div");
    v.className = "tarjeta-valor";
    v.textContent = t.valor;
    const e = document.createElement("div");
    e.className = "tarjeta-etiqueta";
    e.textContent = t.etiqueta;
    div.append(v, e);
    cont.appendChild(div);
  }
}

function pintarOrden() {
  document.querySelectorAll("th[data-orden]").forEach((th) => {
    th.classList.toggle("orden-activo", th.dataset.orden === orden.campo);
    th.dataset.dir = th.dataset.orden === orden.campo ? (orden.asc ? "asc" : "desc") : "";
  });
}

/* -------------------------------- detalle ------------------------------- */

function filaDato(etiqueta, valor, clase) {
  const dt = document.createElement("dt");
  dt.textContent = etiqueta;
  const dd = document.createElement("dd");
  dd.textContent = valor || "—";
  if (!valor) dd.classList.add("vacio-dato");
  if (clase) dd.classList.add(clase);
  return [dt, dd];
}

function abrirDetalle(r) {
  detalleActual = r;

  $("detEstado").className = `chip chip-${slugEstado(r.estado)}`;
  $("detEstado").textContent = r.estado;
  $("detReclamante").textContent = r.reclamante || "Sin reclamante registrado";

  const dias = diasDesde(r.fecha_siniestro);
  const partes = [];
  if (r.radicado) partes.push(`Radicado ${r.radicado}`);
  partes.push(`Siniestro ${fechaSiniestroTexto(r)}`);
  if (dias !== null && estaAbierta(r)) partes.push(`abierta hace ${fmtAntiguedad(dias)}`);
  $("detSub").textContent = partes.join(" · ");

  // Avisos
  const avisos = $("detAvisos");
  avisos.replaceChildren();
  if (r.archivada) {
    const a = document.createElement("p");
    a.className = "aviso aviso-archivada";
    a.textContent = `Archivada el ${fmtMomento(r.archivada_at)}` +
      (r.archivada_motivo ? ` · Motivo: ${r.archivada_motivo}` : "");
    avisos.appendChild(a);
  }
  if (!r.fecha_siniestro && r.fecha_siniestro_texto) {
    const a = document.createElement("p");
    a.className = "aviso";
    a.textContent = `La fecha del siniestro está sin confirmar: en el Excel venía como ` +
      `"${r.fecha_siniestro_texto}", sin día. Edítala para dejarla exacta.`;
    avisos.appendChild(a);
  }

  // Dinero
  const dinero = $("detDinero");
  dinero.replaceChildren();
  const saldo = Number(r.saldo || 0);
  for (const d of [
    { et: "Pretensiones", v: fmtDinero(r.pretensiones) },
    { et: "Pagado", v: fmtDinero(r.pagado), clase: "ok" },
    { et: "Saldo", v: fmtDinero(r.saldo), clase: saldo > 0 && estaAbierta(r) ? "pendiente" : "" },
  ]) {
    const caja = document.createElement("div");
    caja.className = `dinero-caja ${d.clase || ""}`;
    const v = document.createElement("strong");
    v.textContent = d.v;
    const e = document.createElement("span");
    e.textContent = d.et;
    caja.append(v, e);
    dinero.appendChild(caja);
  }

  // Datos
  const dl = $("detDatos");
  dl.replaceChildren();
  const filas = [
    ["Reclamante", r.reclamante], ["Correo", r.correo], ["Teléfono", r.telefono],
    ["Placa tercero", r.placa_tercero, "placa"],
    ["Conductor", r.conductor], ["Afiliado", r.afiliado],
    ["Placa afiliado", r.placa_afiliado, "placa"],
    ["Radicado", r.radicado], ["Fecha de radicado", fmtFecha(r.fecha_radicado)],
    ["Plazo para respuesta", r.plazo_respuesta === null ? null : `${r.plazo_respuesta} días`],
    ["Fecha del siniestro", fechaSiniestroTexto(r)],
    ["Fecha de cierre", fmtFecha(r.fecha_cierre)],
    ["Fecha de pago", fmtFecha(r.fecha_pago)],
  ];
  for (const [et, v, clase] of filas) dl.append(...filaDato(et, v, clase));

  // Pestañas: siempre se abre en Datos
  cambiarPestana("panelDatos");
  $("btnArchivar").hidden = Boolean(r.archivada);
  $("btnRestaurar").hidden = !r.archivada;

  $("modalDetalle").showModal();
  cargarBitacora(r.id);
  cargarHistorial(r.id);
}

function cambiarPestana(panelId) {
  document.querySelectorAll(".pestana").forEach((p) =>
    p.classList.toggle("activa", p.dataset.panel === panelId));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== panelId; });
}

async function cargarBitacora(id) {
  const cont = $("detBitacora");
  cont.replaceChildren();

  const { data, error } = await db
    .from(TABLA_SEGUIMIENTOS)
    .select("*")
    .eq("reclamacion_id", id)
    .order("fecha", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false });

  if (error) return toast(mensajeError(error), "error");
  $("badgeBitacora").textContent = data.length;

  if (!data.length) {
    const li = document.createElement("li");
    li.className = "linea-vacia";
    li.textContent = "Todavía no hay gestiones registradas. Agrega la primera arriba.";
    cont.appendChild(li);
    return;
  }

  for (const s of data) {
    const li = document.createElement("li");
    li.className = "linea-item" + (s.importado ? " linea-importada" : "");

    const cab = document.createElement("div");
    cab.className = "linea-cab";
    const fecha = document.createElement("strong");
    fecha.textContent = fmtFecha(s.fecha) || "sin fecha";
    const autor = document.createElement("span");
    autor.textContent = s.importado ? "Importado del Excel" : (s.autor_correo || "—");
    cab.append(fecha, autor);

    const nota = document.createElement("p");
    nota.className = "linea-nota";
    nota.textContent = s.nota;

    li.append(cab, nota);
    cont.appendChild(li);
  }
}

async function cargarHistorial(id) {
  const cont = $("detHistorial");
  cont.replaceChildren();

  const { data, error } = await db
    .from(TABLA_AUDITORIA)
    .select("*")
    .eq("reclamacion_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) return toast(mensajeError(error), "error");
  $("badgeHistorial").textContent = data.length;

  if (!data.length) {
    const li = document.createElement("li");
    li.className = "linea-vacia";
    li.textContent = "Sin cambios registrados. El historial arranca desde que se " +
                     "activó la auditoría, así que los datos importados del Excel no aparecen.";
    cont.appendChild(li);
    return;
  }

  for (const a of data) {
    const li = document.createElement("li");
    li.className = "linea-item";

    const cab = document.createElement("div");
    cab.className = "linea-cab";
    const acc = document.createElement("strong");
    // Archivado y restaurado ya se explican solos; el resto nombra el campo.
    acc.textContent = a.accion === "EDICION"
      ? (ETIQUETAS[a.campo] || a.campo)
      : (ACCIONES[a.accion] || a.accion);
    const meta = document.createElement("span");
    meta.textContent = `${a.actor_correo || "sistema"} · ${fmtMomento(a.created_at)}`;
    cab.append(acc, meta);
    li.appendChild(cab);

    if (a.campo && a.accion === "EDICION") {
      const cambio = document.createElement("p");
      cambio.className = "linea-cambio";
      const antes = document.createElement("span");
      antes.className = "valor-antes";
      antes.textContent = fmtValorAuditoria(a.campo, a.antes);
      const flecha = document.createElement("span");
      flecha.className = "valor-flecha";
      flecha.textContent = "→";
      const despues = document.createElement("span");
      despues.className = "valor-despues";
      despues.textContent = fmtValorAuditoria(a.campo, a.despues);
      cambio.append(antes, flecha, despues);
      li.appendChild(cambio);
    } else if (a.accion === "ARCHIVADO" && a.despues) {
      const p = document.createElement("p");
      p.className = "linea-nota";
      p.textContent = detalleActual?.archivada_motivo || "";
      if (p.textContent) li.appendChild(p);
    }
    cont.appendChild(li);
  }
}

async function agregarSeguimiento(evento) {
  evento.preventDefault();
  const btn = $("btnAgregarSeg");
  const err = $("segError");
  err.hidden = true;

  const nota = $("segNota").value.trim();
  if (!nota) return;

  btn.disabled = true;
  btn.textContent = "Agregando…";

  const { error } = await db.from(TABLA_SEGUIMIENTOS).insert({
    reclamacion_id: detalleActual.id,
    fecha: $("segFecha").value || hoyIso(),
    nota,
  });

  btn.disabled = false;
  btn.textContent = "Agregar al historial";

  if (error) {
    err.textContent = mensajeError(error);
    err.hidden = false;
    return;
  }
  $("segNota").value = "";
  $("segFecha").value = hoyIso();
  toast("Gestión agregada");
  await cargarBitacora(detalleActual.id);
}

/* ------------------------------- archivar ------------------------------- */

function pedirArchivar() {
  $("archivarMotivo").value = "";
  $("archivarError").hidden = true;
  $("modalArchivar").showModal();
}

async function confirmarArchivar(evento) {
  evento.preventDefault();
  const motivo = $("archivarMotivo").value.trim();
  const err = $("archivarError");
  if (!motivo) {
    err.textContent = "Escribe el motivo: queda en el historial del caso.";
    err.hidden = false;
    return;
  }
  const btn = $("btnConfirmarArchivar");
  btn.disabled = true;
  btn.textContent = "Archivando…";

  const { error } = await db.from(TABLA_RECLAMACIONES)
    .update({ archivada: true, archivada_motivo: motivo })
    .eq("id", detalleActual.id);

  btn.disabled = false;
  btn.textContent = "Archivar";

  if (error) {
    err.textContent = mensajeError(error);
    err.hidden = false;
    return;
  }
  $("modalArchivar").close();
  $("modalDetalle").close();
  toast("Reclamación archivada");
  await cargar();
}

async function restaurar() {
  if (!confirm("¿Devolver esta reclamación a la lista activa?")) return;
  const { error } = await db.from(TABLA_RECLAMACIONES)
    .update({ archivada: false })
    .eq("id", detalleActual.id);
  if (error) return toast(mensajeError(error), "error");
  $("modalDetalle").close();
  toast("Reclamación restaurada");
  await cargar();
}

/* --------------------------------- modal -------------------------------- */

function abrirModal(r = null) {
  $("modalDetalle").close();
  editandoId = r ? r.id : null;
  $("modalTitulo").textContent = r ? "Editar reclamación" : "Nueva reclamación";
  $("modalError").hidden = true;

  for (const c of CAMPOS) {
    const el = $(`f_${c}`);
    if (el) el.value = r && r[c] !== null && r[c] !== undefined ? r[c] : "";
  }
  if (!r) $("f_estado").value = "EN ESTUDIO";

  const dudosa = Boolean(r && !r.fecha_siniestro && r.fecha_siniestro_texto);
  $("wrapFechaTexto").hidden = !dudosa;
  if (dudosa) $("f_fecha_siniestro_texto").value = r.fecha_siniestro_texto;

  const aud = $("modalAuditoria");
  if (r) {
    aud.textContent = `Creada: ${fmtMomento(r.created_at)}` +
                      ` · Última edición: ${fmtMomento(r.updated_at)}`;
    aud.hidden = false;
  } else {
    aud.hidden = true;
  }

  $("modal").showModal();
}

function cerrarModal() {
  $("modal").close();
  editandoId = null;
}

function leerFormulario() {
  const reg = {};
  for (const c of CAMPOS) {
    const el = $(`f_${c}`);
    if (!el) continue;
    let v = el.value.trim();
    if (MAYUSCULAS.includes(c)) v = v.toUpperCase();
    if (v === "") { reg[c] = null; continue; }
    reg[c] = NUMERICOS.includes(c) ? Number(v) : v;
  }
  // Si le pusieron la fecha real, el texto crudo de la migracion ya sobra.
  if (reg.fecha_siniestro) reg.fecha_siniestro_texto = null;
  return reg;
}

async function guardar(evento) {
  evento.preventDefault();
  const btn = $("btnGuardar");
  const err = $("modalError");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const reg = leerFormulario();
  const { error } = editandoId
    ? await db.from(TABLA_RECLAMACIONES).update(reg).eq("id", editandoId)
    : await db.from(TABLA_RECLAMACIONES).insert(reg);

  btn.disabled = false;
  btn.textContent = "Guardar";

  if (error) {
    err.textContent = mensajeError(error);
    err.hidden = false;
    return;
  }
  toast(editandoId ? "Reclamación actualizada" : "Reclamación creada");
  cerrarModal();
  await cargar();
}

/* -------------------------------- exportar ------------------------------ */

function exportarCsv() {
  const lista = filtradas();
  if (!lista.length) return toast("No hay nada que exportar", "error");

  const cabeceras = [...CAMPOS, "saldo", "archivada", "archivada_motivo"];
  const escapar = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const filas = [
    cabeceras.join(";"),
    ...lista.map((r) => cabeceras.map((c) => escapar(r[c])).join(";")),
  ];
  // BOM para que Excel abra las tildes bien.
  const blob = new Blob(["﻿" + filas.join("\r\n")],
                        { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `reclamaciones_${hoyIso()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${lista.length} filas exportadas`);
}

/* ---------------------------------- tema -------------------------------- */

// Sin preferencia guardada manda el sistema (lo resuelve el CSS).
function aplicarTema(tema) {
  if (tema) document.documentElement.dataset.tema = tema;
  else delete document.documentElement.dataset.tema;
}

function temaActual() {
  const guardado = localStorage.getItem("tema");
  if (guardado) return guardado;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
}

function alternarTema() {
  const nuevo = temaActual() === "oscuro" ? "claro" : "oscuro";
  localStorage.setItem("tema", nuevo);
  aplicarTema(nuevo);
}

/* --------------------------------- init --------------------------------- */

function poblarEstados() {
  for (const e of ESTADOS) {
    const o1 = document.createElement("option");
    o1.value = o1.textContent = e;
    $("filtroEstado").appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = o2.textContent = e;
    $("f_estado").appendChild(o2);
  }
}

function init() {
  aplicarTema(localStorage.getItem("tema"));
  poblarEstados();
  $("segFecha").value = hoyIso();

  $("btnTema").addEventListener("click", alternarTema);
  $("formLogin").addEventListener("submit", iniciarSesion);
  $("btnSalir").addEventListener("click", cerrarSesion);
  $("btnNueva").addEventListener("click", () => abrirModal());
  $("btnExportar").addEventListener("click", exportarCsv);
  $("formReclamacion").addEventListener("submit", guardar);
  $("btnCancelar").addEventListener("click", cerrarModal);
  $("btnCerrarModal").addEventListener("click", cerrarModal);
  $("buscar").addEventListener("input", pintar);
  $("filtroEstado").addEventListener("change", pintar);
  $("verArchivadas").addEventListener("change", pintar);

  $("btnCerrarDetalle").addEventListener("click", () => $("modalDetalle").close());
  $("btnCerrarDetalle2").addEventListener("click", () => $("modalDetalle").close());
  $("btnEditarDesdeDetalle").addEventListener("click", () => abrirModal(detalleActual));
  $("btnArchivar").addEventListener("click", pedirArchivar);
  $("btnRestaurar").addEventListener("click", restaurar);
  $("formSeguimiento").addEventListener("submit", agregarSeguimiento);
  $("formArchivar").addEventListener("submit", confirmarArchivar);
  $("btnCancelarArchivar").addEventListener("click", () => $("modalArchivar").close());

  document.querySelectorAll(".pestana").forEach((p) =>
    p.addEventListener("click", () => cambiarPestana(p.dataset.panel)));

  document.querySelectorAll("th[data-orden]").forEach((th) => {
    th.addEventListener("click", () => {
      const campo = th.dataset.orden;
      orden = { campo, asc: orden.campo === campo ? !orden.asc : true };
      pintar();
    });
  });

  // v2 emite INITIAL_SESSION al suscribirse, asi que esto ya cubre el arranque
  // y no hace falta un getSession() aparte.
  // El trabajo se difiere con setTimeout: llamar al cliente de Supabase dentro
  // del callback lo bloquea.
  db.auth.onAuthStateChange((_evento, sesion) => {
    setTimeout(() => {
      if (sesion) mostrarApp(sesion);
      else mostrarLogin();
    }, 0);
  });
}

init();
