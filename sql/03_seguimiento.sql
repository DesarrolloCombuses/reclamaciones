-- =====================================================================
-- RECLAMACIONES - Archivar, bitacora de seguimiento y auditoria
-- Ejecutar despues de 01_schema.sql y 02_datos.sql.
-- Aditivo: no borra datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Archivar en lugar de borrar
-- ---------------------------------------------------------------------
alter table public.reclamaciones
  add column if not exists archivada        boolean not null default false,
  add column if not exists archivada_motivo text,
  add column if not exists archivada_at     timestamptz,
  add column if not exists archivada_by     uuid references auth.users (id) on delete set null;

comment on column public.reclamaciones.archivada is
  'Sustituye al borrado: la fila se oculta de la lista pero nunca se pierde.';

create index if not exists reclamaciones_archivada_idx
  on public.reclamaciones (archivada) where not archivada;

-- Nadie borra: ni desde la app ni por fuera de ella.
drop policy if exists reclamaciones_delete on public.reclamaciones;

-- Sella la fecha y el autor del archivado sin depender del cliente.
create or replace function public.reclamaciones_sellar_archivado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archivada and not old.archivada then
    new.archivada_at := now();
    new.archivada_by := auth.uid();
  elsif not new.archivada and old.archivada then
    new.archivada_at := null;
    new.archivada_by := null;
    new.archivada_motivo := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reclamaciones_sellar_archivado_trg on public.reclamaciones;
create trigger reclamaciones_sellar_archivado_trg
  before update on public.reclamaciones
  for each row execute function public.reclamaciones_sellar_archivado();

-- ---------------------------------------------------------------------
-- 2. Saldo pendiente
--    Columna generada: siempre cuadra con pretensiones/pagado y se puede
--    ordenar y filtrar desde el servidor.
-- ---------------------------------------------------------------------
alter table public.reclamaciones
  add column if not exists saldo numeric(14,2)
    generated always as (coalesce(pretensiones, 0) - coalesce(pagado, 0)) stored;

comment on column public.reclamaciones.saldo is
  'Calculada: pretensiones - pagado. No se escribe a mano.';

-- ---------------------------------------------------------------------
-- 3. Bitacora de seguimiento
--    Una entrada por gestion. No se edita ni se borra: es el historial
--    del caso y puede acabar en un juzgado.
-- ---------------------------------------------------------------------
create table if not exists public.reclamaciones_seguimientos (
  id             bigint generated always as identity primary key,
  reclamacion_id bigint not null references public.reclamaciones (id) on delete cascade,
  fecha          date,
  nota           text not null,
  autor_id       uuid references auth.users (id) on delete set null,
  autor_correo   text,
  importado      boolean     not null default false,
  created_at     timestamptz not null default now(),
  constraint reclamaciones_seguimientos_nota_check check (btrim(nota) <> '')
);

comment on table public.reclamaciones_seguimientos is
  'Bitacora del caso. Solo se agrega; no se edita ni se borra.';
comment on column public.reclamaciones_seguimientos.importado is
  'true = viene del campo OBSERVACIONES del Excel original, no de la app.';

create index if not exists reclamaciones_seguimientos_reclamacion_idx
  on public.reclamaciones_seguimientos (reclamacion_id, fecha desc nulls last, id desc);

-- El autor lo pone el servidor, no el navegador: un cliente no puede
-- firmar una entrada con el nombre de otro ni colarla como importada.
-- La migracion del historico corre sin sesion (auth.uid() nulo) y por eso
-- es el unico caso que puede fijar importado y autor_correo a mano.
create or replace function public.reclamaciones_seguimientos_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.autor_id     := auth.uid();
    new.autor_correo := (select auth.jwt() ->> 'email');
    new.importado    := false;
  end if;
  new.created_at := now();
  if new.fecha is null then
    new.fecha := current_date;
  end if;
  return new;
end;
$$;

drop trigger if exists reclamaciones_seguimientos_stamp_trg on public.reclamaciones_seguimientos;
create trigger reclamaciones_seguimientos_stamp_trg
  before insert on public.reclamaciones_seguimientos
  for each row execute function public.reclamaciones_seguimientos_stamp();

-- ---------------------------------------------------------------------
-- 4. Auditoria: quien cambio que y cuando
--    Sin FK a reclamaciones a proposito: el rastro debe sobrevivir a
--    cualquier cosa que le pase a la fila original.
-- ---------------------------------------------------------------------
create table if not exists public.reclamaciones_auditoria (
  id             bigint generated always as identity primary key,
  reclamacion_id bigint not null,
  accion         text   not null,
  campo          text,
  antes          text,
  despues        text,
  actor_id       uuid,
  actor_correo   text,
  created_at     timestamptz not null default now()
);

create index if not exists reclamaciones_auditoria_reclamacion_idx
  on public.reclamaciones_auditoria (reclamacion_id, created_at desc);

-- Campos que no aportan nada al historial.
create or replace function public.reclamaciones_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j_old  jsonb;
  j_new  jsonb := to_jsonb(new);
  k      text;
  correo text := (select auth.jwt() ->> 'email');
  ignorar text[] := array['updated_at', 'updated_by', 'created_at', 'created_by',
                          'archivada_at', 'archivada_by', 'saldo'];
begin
  if tg_op = 'INSERT' then
    insert into public.reclamaciones_auditoria
      (reclamacion_id, accion, actor_id, actor_correo)
    values (new.id, 'CREACION', auth.uid(), correo);
    return new;
  end if;

  j_old := to_jsonb(old);
  for k in select jsonb_object_keys(j_new) loop
    continue when k = any (ignorar);
    if (j_old ->> k) is distinct from (j_new ->> k) then
      insert into public.reclamaciones_auditoria
        (reclamacion_id, accion, campo, antes, despues, actor_id, actor_correo)
      values (
        new.id,
        case k when 'archivada' then
          case when new.archivada then 'ARCHIVADO' else 'RESTAURADO' end
        else 'EDICION' end,
        k, j_old ->> k, j_new ->> k, auth.uid(), correo
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists reclamaciones_auditar_trg on public.reclamaciones;
create trigger reclamaciones_auditar_trg
  after insert or update on public.reclamaciones
  for each row execute function public.reclamaciones_auditar();

-- ---------------------------------------------------------------------
-- 5. RLS de las tablas nuevas: mismas reglas que reclamaciones
-- ---------------------------------------------------------------------
alter table public.reclamaciones_seguimientos enable row level security;
alter table public.reclamaciones_auditoria    enable row level security;

drop policy if exists reclamaciones_seguimientos_select on public.reclamaciones_seguimientos;
create policy reclamaciones_seguimientos_select on public.reclamaciones_seguimientos
  for select to authenticated
  using (public.reclamaciones_autorizado());

drop policy if exists reclamaciones_seguimientos_insert on public.reclamaciones_seguimientos;
create policy reclamaciones_seguimientos_insert on public.reclamaciones_seguimientos
  for insert to authenticated
  with check (public.reclamaciones_autorizado());

-- Sin policies de update/delete: una bitacora que se puede reescribir no
-- sirve como prueba. Lo mismo para la auditoria, que ademas solo se lee.
drop policy if exists reclamaciones_auditoria_select on public.reclamaciones_auditoria;
create policy reclamaciones_auditoria_select on public.reclamaciones_auditoria
  for select to authenticated
  using (public.reclamaciones_autorizado());

-- ---------------------------------------------------------------------
-- 6. El historico del Excel pasa a ser la primera entrada de la bitacora
--    La columna observaciones se conserva intacta como respaldo, pero la
--    app ya no la usa.
-- ---------------------------------------------------------------------
insert into public.reclamaciones_seguimientos
  (reclamacion_id, fecha, nota, autor_correo, importado, created_at)
select r.id,
       coalesce(r.fecha_radicado, r.fecha_siniestro),
       btrim(r.observaciones),
       'Importado del Excel',
       true,
       now()
from public.reclamaciones r
where r.observaciones is not null
  and btrim(r.observaciones) <> ''
  and not exists (
    select 1 from public.reclamaciones_seguimientos s
    where s.reclamacion_id = r.id and s.importado
  );

comment on column public.reclamaciones.observaciones is
  'Historico del Excel. Migrado a reclamaciones_seguimientos (importado=true); '
  'se conserva como respaldo pero la app ya no lo lee ni lo escribe.';
