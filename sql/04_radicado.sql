-- =====================================================================
-- RECLAMACIONES - Radicado automatico y organizado
-- Formato: consecutivo con ceros a 4 digitos (0001, 0002, ...).
-- Renumera los 45 existentes en orden cronologico y asigna el siguiente
-- a cada caso nuevo. Ejecutar despues de 01 y 03.
-- =====================================================================

-- Secuencia que alimenta los radicados nuevos.
create sequence if not exists public.reclamaciones_radicado_seq;

-- Asigna el radicado en el INSERT si viene vacio (la app lo manda vacio).
create or replace function public.reclamaciones_asignar_radicado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.radicado is null or btrim(new.radicado) = '' then
    new.radicado := lpad(nextval('public.reclamaciones_radicado_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists reclamaciones_radicado_trg on public.reclamaciones;
create trigger reclamaciones_radicado_trg
  before insert on public.reclamaciones
  for each row execute function public.reclamaciones_asignar_radicado();

-- ---------------------------------------------------------------------
-- Backfill de los existentes, sin disparar auditoria ni tocar timestamps:
-- la asignacion inicial no es una "edicion" del usuario.
-- ---------------------------------------------------------------------
alter table public.reclamaciones disable trigger reclamaciones_touch_trg;
alter table public.reclamaciones disable trigger reclamaciones_auditar_trg;

with ordenado as (
  select id,
         row_number() over (
           order by coalesce(fecha_radicado, fecha_siniestro, created_at::date) asc, id asc
         ) as n
  from public.reclamaciones
)
update public.reclamaciones r
set radicado = lpad(o.n::text, 4, '0')
from ordenado o
where o.id = r.id;

alter table public.reclamaciones enable trigger reclamaciones_touch_trg;
alter table public.reclamaciones enable trigger reclamaciones_auditar_trg;

-- La secuencia continua despues del ultimo asignado (-> el proximo es 0046).
select setval('public.reclamaciones_radicado_seq',
              (select coalesce(max(radicado::int), 0) from public.reclamaciones));

-- Radicados unicos (la app lo deja de solo lectura, asi que no habra choques).
create unique index if not exists reclamaciones_radicado_uidx
  on public.reclamaciones (radicado);

comment on column public.reclamaciones.radicado is
  'Consecutivo con ceros (0001...). Lo asigna la base sola; no se edita a mano.';
