-- =====================================================================
-- RECLAMACIONES EN CONTRA - Esquema
-- Proyecto Supabase: cbplebkmxrkaafqdhiyi (COMPARTIDO con la planilla
-- de enturnamiento). Este script es ADITIVO: solo crea objetos nuevos
-- con el prefijo "reclamaciones". No toca ninguna tabla existente.
--
-- Ejecutar en: Supabase -> SQL Editor -> New query -> Run
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabla principal
-- ---------------------------------------------------------------------
create table if not exists public.reclamaciones (
  id                    bigint generated always as identity primary key,

  estado                text not null default 'EN ESTUDIO',
  radicado              text,
  fecha_radicado        date,
  plazo_respuesta       integer,
  fecha_cierre          date,

  fecha_siniestro       date,
  -- Solo se llena cuando el original no era una fecha completa
  -- (la hoja traia valores como 'oct-25' o 'may-26', sin dia).
  fecha_siniestro_texto text,

  conductor             text,
  afiliado              text,
  placa_afiliado        text,

  reclamante            text,
  correo                text,
  telefono              text,
  placa_tercero         text,

  pretensiones          numeric(14,2),
  pagado                numeric(14,2),
  fecha_pago            date,

  observaciones         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  updated_by            uuid references auth.users (id) on delete set null,

  constraint reclamaciones_estado_check check (estado in (
    'EN ESTUDIO',
    'FALTAN DOCUMENTOS',
    'REDIRECCIONADO A LA ASEGURADORA',
    'OBJETADO',
    'PENDIENTE DE PAGO',
    'PAGADO'
  )),
  constraint reclamaciones_pretensiones_check check (pretensiones is null or pretensiones >= 0),
  constraint reclamaciones_pagado_check       check (pagado       is null or pagado       >= 0)
);

comment on column public.reclamaciones.plazo_respuesta is
  'Dias de plazo. En la hoja original era una formula de Excel rota; los '
  'valores absurdos (|v| > 5000, restos de fechas seriales) se migraron como NULL.';
comment on column public.reclamaciones.fecha_siniestro_texto is
  'Valor crudo del CSV cuando no se pudo interpretar como fecha completa.';

create index if not exists reclamaciones_estado_idx          on public.reclamaciones (estado);
create index if not exists reclamaciones_fecha_siniestro_idx on public.reclamaciones (fecha_siniestro desc nulls last);
create index if not exists reclamaciones_placa_afiliado_idx  on public.reclamaciones (placa_afiliado);
create index if not exists reclamaciones_placa_tercero_idx   on public.reclamaciones (placa_tercero);

-- ---------------------------------------------------------------------
-- 2. Auditoria automatica de updated_at / updated_by
-- ---------------------------------------------------------------------
create or replace function public.reclamaciones_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- created_at / created_by son inmutables una vez escritos
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists reclamaciones_touch_trg on public.reclamaciones;
create trigger reclamaciones_touch_trg
  before update on public.reclamaciones
  for each row execute function public.reclamaciones_touch();

create or replace function public.reclamaciones_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists reclamaciones_stamp_trg on public.reclamaciones;
create trigger reclamaciones_stamp_trg
  before insert on public.reclamaciones
  for each row execute function public.reclamaciones_stamp();

-- ---------------------------------------------------------------------
-- 3. RLS
--    Auth es compartido con la planilla de enturnamiento y hay 24 cuentas,
--    3 de ellas fuera del dominio (zci.com, hotmail, gmail). Por eso
--    'authenticated' no basta: se exige ademas correo corporativo.
-- ---------------------------------------------------------------------
create or replace function public.reclamaciones_autorizado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
       (select auth.jwt() ->> 'email') like '%@combuses.com.co'
    or (select auth.jwt() ->> 'email') like '%@combuses.com',
    false
  );
$$;

comment on function public.reclamaciones_autorizado is
  'Autoriza a cualquier cuenta con correo @combuses. Para cerrar el acceso a '
  'personas concretas hay que pasar a una lista blanca (ver README).';

alter table public.reclamaciones enable row level security;

-- reclamaciones: CRUD completo, solo para autorizados
drop policy if exists reclamaciones_select on public.reclamaciones;
create policy reclamaciones_select on public.reclamaciones
  for select to authenticated
  using (public.reclamaciones_autorizado());

drop policy if exists reclamaciones_insert on public.reclamaciones;
create policy reclamaciones_insert on public.reclamaciones
  for insert to authenticated
  with check (public.reclamaciones_autorizado());

drop policy if exists reclamaciones_update on public.reclamaciones;
create policy reclamaciones_update on public.reclamaciones
  for update to authenticated
  using (public.reclamaciones_autorizado())
  with check (public.reclamaciones_autorizado());

drop policy if exists reclamaciones_delete on public.reclamaciones;
create policy reclamaciones_delete on public.reclamaciones
  for delete to authenticated
  using (public.reclamaciones_autorizado());

-- =====================================================================
-- 4. Quien entra
--    No hay nada que autorizar a mano: cualquier cuenta @combuses que
--    exista en Auth entra. Para crear una cuenta nueva:
--    Supabase -> Authentication -> Users -> Add user (Auto Confirm User).
-- =====================================================================
