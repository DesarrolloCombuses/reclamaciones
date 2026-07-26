// Configuracion de Supabase.
//
// La clave publishable es publica por diseno: viaja al navegador en cualquier
// caso. Lo que protege los datos es la RLS del servidor (ver sql/01_schema.sql),
// que exige que el usuario este en la tabla reclamaciones_usuarios.
// Nunca pongas aqui la service_role key.

const SUPABASE_URL = "https://cbplebkmxrkaafqdhiyi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DZCceNTENY4ViP17-eZrGg_bdMElZ9X";

const TABLA_RECLAMACIONES = "reclamaciones";
const TABLA_SEGUIMIENTOS = "reclamaciones_seguimientos";
const TABLA_AUDITORIA = "reclamaciones_auditoria";

const ESTADOS = [
  "EN ESTUDIO",
  "FALTAN DOCUMENTOS",
  "REDIRECCIONADO A LA ASEGURADORA",
  "OBJETADO",
  "PENDIENTE DE PAGO",
  "PAGADO",
];

// Solo para el chip de la tabla: a 32 caracteres el chip desborda la fila.
// El nombre completo sigue en el filtro, en el formulario y en el title.
const ESTADOS_CORTOS = {
  "REDIRECCIONADO A LA ASEGURADORA": "ASEGURADORA",
};
