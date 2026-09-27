-- ============================================================================
-- DERROTERO — schema.sql
-- Route-side evidence instrument · Week 7
--
-- CÓMO USARLO:
--   1. Supabase → proyecto "Derrotero" → SQL Editor → New query
--   2. Pega TODO este archivo y presiona Run
--   3. Guarda el archivo en tu repo como  supabase/schema.sql
--
-- PRINCIPIO DE DISEÑO (Condición 2 del Blueprint, la cláusula sombra):
--   La parte medida es dueña de la medición y la recibe primero.
--   Aquí eso NO es una promesa de interfaz: es Row Level Security.
--   Nadie lee una fila si no es miembro de la asociación dueña.
--   Compartir es la AUSENCIA de un permiso, no una casilla: sin una
--   concesión vigente en share_grants, no existe lectura externa.
--
-- PRINCIPIO 2 (Condición 3):
--   No hay identidad de operador en ningún campo de ninguna tabla.
--   Un dato que no existe no se puede filtrar, vender ni usar en contra.
-- ============================================================================

create extension if not exists pgcrypto;


-- ============================================================================
-- 1. ASOCIACIONES
-- ============================================================================
create table if not exists public.associations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  municipality  text not null default 'Naucalpan de Juárez'
                  check (char_length(municipality) between 2 and 120),
  created_at    timestamptz not null default now()
);


-- ============================================================================
-- 2. MEMBRESÍAS  (Opción A: la pertenencia se asigna a mano)
--    Conecta una cuenta de Google con su asociación. De esta tabla depende
--    TODO el control de acceso.
-- ============================================================================
create table if not exists public.memberships (
  user_id         uuid not null references auth.users(id) on delete cascade,
  association_id  uuid not null references public.associations(id) on delete cascade,
  role            text not null default 'dirigencia'
                    check (role in ('dirigencia','operador')),
  created_at      timestamptz not null default now(),
  primary key (user_id, association_id)
);

-- Función auxiliar: ¿el usuario actual pertenece a esta asociación?
-- security definer para que las políticas puedan consultarla sin recursión.
create or replace function public.is_member(a_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.memberships m
     where m.association_id = a_id
       and m.user_id = auth.uid()
  );
$$;


-- ============================================================================
-- 3. UNIDADES
--    Se identifica el VEHÍCULO, nunca a la persona que lo conduce.
--    No hay columna de nombre, licencia, teléfono ni id de operador.
-- ============================================================================
create table if not exists public.units (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references public.associations(id) on delete cascade,
  economic_number  text not null check (char_length(economic_number) between 1 and 20),
  created_at       timestamptz not null default now(),
  unique (association_id, economic_number)
);


-- ============================================================================
-- 4. TURNOS
-- ============================================================================
create table if not exists public.shifts (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  is_simulated    boolean not null default true,
  created_at      timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists shifts_assoc_idx on public.shifts (association_id, started_at desc);


-- ============================================================================
-- 5. PINGS  (telemetría cruda del teléfono)
-- ============================================================================
create table if not exists public.pings (
  id              bigserial primary key,
  association_id  uuid not null references public.associations(id) on delete cascade,
  shift_id        uuid not null references public.shifts(id) on delete cascade,
  captured_at     timestamptz not null,
  lat             double precision not null check (lat between -90 and 90),
  lon             double precision not null check (lon between -180 and 180),
  speed_kmh       double precision check (speed_kmh >= 0 and speed_kmh <= 200),
  is_simulated    boolean not null default true
);
create index if not exists pings_shift_idx on public.pings (shift_id, captured_at);
create index if not exists pings_assoc_idx on public.pings (association_id, captured_at desc);


-- ============================================================================
-- 6. PARADAS INFERIDAS  (salida del DBSCAN)
--    Cada cifra carga su confianza y cuántas corridas la respaldan:
--    Condición 4 — nada se muestra como certeza ni como orden.
-- ============================================================================
create table if not exists public.inferred_stops (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references public.associations(id) on delete cascade,
  route_label        text not null default 'San Bartolo – Toreo'
                       check (char_length(route_label) between 2 and 120),
  lat                double precision not null check (lat between -90 and 90),
  lon                double precision not null check (lon between -180 and 180),
  label              text check (label is null or char_length(label) <= 80),
  dwell_seconds_avg  numeric check (dwell_seconds_avg >= 0),
  boardings_est      integer check (boardings_est >= 0),
  runs_observed      integer not null default 0 check (runs_observed >= 0),
  confidence         text not null default 'media'
                       check (confidence in ('baja','media','alta')),
  in_official_padron boolean not null default false,
  computed_at        timestamptz not null default now(),
  is_simulated       boolean not null default true
);


-- ============================================================================
-- 7. MÉTRICAS DE CORRIDA  (intervalos reales y ocupación al salir de base)
--    Aquí vive el hallazgo: la salida es por llenado, no por reloj.
-- ============================================================================
create table if not exists public.run_metrics (
  id                       uuid primary key default gen_random_uuid(),
  association_id           uuid not null references public.associations(id) on delete cascade,
  shift_id                 uuid references public.shifts(id) on delete cascade,
  departed_at              timestamptz not null,
  headway_minutes          numeric check (headway_minutes >= 0),
  occupancy_at_departure   numeric check (occupancy_at_departure between 0 and 1),
  confidence               text not null default 'media'
                             check (confidence in ('baja','media','alta')),
  is_simulated             boolean not null default true
);
create index if not exists run_metrics_assoc_idx
  on public.run_metrics (association_id, departed_at);


-- ============================================================================
-- 8. CONCESIONES DE LECTURA  (la cláusula sombra, hecha tabla)
--    NO existe una casilla "compartir: sí/no".
--    Compartir = existe una fila vigente aquí. Revocar = se sella revoked_at.
--    Por defecto no hay filas, así que por defecto no se comparte.
--    Nunca es exclusiva: pueden coexistir varias concesiones, así que la
--    asociación jamás queda atada a un solo destinatario.
-- ============================================================================
create table if not exists public.share_grants (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references public.associations(id) on delete cascade,
  token            text not null unique default encode(gen_random_bytes(24),'hex'),
  recipient_label  text not null check (char_length(recipient_label) between 2 and 120),
  granted_by       uuid not null references auth.users(id),
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);
create index if not exists share_grants_assoc_idx
  on public.share_grants (association_id, granted_at desc);


-- ============================================================================
-- 9. LECTURA EXTERNA POR TOKEN
--    Única puerta hacia afuera. Devuelve el expediente SOLO si existe una
--    concesión vigente. Jamás expone pings crudos ni ids internos.
-- ============================================================================
create or replace function public.dossier_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  g public.share_grants;
  result jsonb;
begin
  if p_token is null or char_length(p_token) <> 48 then
    return null;
  end if;

  select * into g
    from public.share_grants
   where token = p_token
     and revoked_at is null;

  if not found then
    return null;   -- revocada o inexistente: se ve igual que si nunca existió
  end if;

  select jsonb_build_object(
    'asociacion',   (select name from public.associations where id = g.association_id),
    'destinatario', g.recipient_label,
    'compartido_el', g.granted_at,
    'corte_al',     now(),
    'paradas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'lat', s.lat, 'lon', s.lon, 'etiqueta', s.label,
                 'ascensos_est', s.boardings_est,
                 'detencion_media_s', s.dwell_seconds_avg,
                 'corridas_observadas', s.runs_observed,
                 'confianza', s.confidence,
                 'en_padron_oficial', s.in_official_padron,
                 'simulado', s.is_simulated))
          from public.inferred_stops s
         where s.association_id = g.association_id), '[]'::jsonb),
    'corridas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'salida', r.departed_at,
                 'intervalo_min', r.headway_minutes,
                 'ocupacion_al_salir', r.occupancy_at_departure,
                 'confianza', r.confidence,
                 'simulado', r.is_simulated))
          from public.run_metrics r
         where r.association_id = g.association_id), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.dossier_by_token(text) to anon, authenticated;


-- ============================================================================
-- 10. ROW LEVEL SECURITY
--     Se enciende en TODAS las tablas. Sin política aplicable = sin lectura.
--     El rol anon no recibe NINGUNA política: desde fuera no se ve nada.
-- ============================================================================
alter table public.associations   enable row level security;
alter table public.memberships    enable row level security;
alter table public.units          enable row level security;
alter table public.shifts         enable row level security;
alter table public.pings          enable row level security;
alter table public.inferred_stops enable row level security;
alter table public.run_metrics    enable row level security;
alter table public.share_grants   enable row level security;

-- associations: solo la ves si perteneces a ella
drop policy if exists assoc_select on public.associations;
create policy assoc_select on public.associations
  for select to authenticated
  using (public.is_member(id));

-- memberships: solo ves tus propias membresías
drop policy if exists memb_select on public.memberships;
create policy memb_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- units
drop policy if exists units_rw on public.units;
create policy units_rw on public.units
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id));

-- shifts
drop policy if exists shifts_rw on public.shifts;
create policy shifts_rw on public.shifts
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id));

-- pings
drop policy if exists pings_rw on public.pings;
create policy pings_rw on public.pings
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id));

-- inferred_stops
drop policy if exists stops_rw on public.inferred_stops;
create policy stops_rw on public.inferred_stops
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id));

-- run_metrics
drop policy if exists runs_rw on public.run_metrics;
create policy runs_rw on public.run_metrics
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id));

-- share_grants: solo la dirigencia de la asociación concede o revoca
drop policy if exists grants_rw on public.share_grants;
create policy grants_rw on public.share_grants
  for all to authenticated
  using (public.is_member(association_id))
  with check (public.is_member(association_id) and granted_by = auth.uid());


-- ============================================================================
-- 11. SEMILLA — datos simulados, etiquetados
--     Ninguna persona real aparece aquí (Security Floor #5).
-- ============================================================================
insert into public.associations (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Asociación de Ruta — corredor San Bartolo (SIMULADA)')
on conflict (id) do nothing;

insert into public.associations (id, name)
values ('22222222-2222-2222-2222-222222222222', 'Asociación vecina — prueba de aislamiento (SIMULADA)')
on conflict (id) do nothing;

insert into public.units (association_id, economic_number)
values ('11111111-1111-1111-1111-111111111111','SB-01'),
       ('11111111-1111-1111-1111-111111111111','SB-02'),
       ('11111111-1111-1111-1111-111111111111','SB-03'),
       ('22222222-2222-2222-2222-222222222222','VX-99')
on conflict do nothing;


-- ============================================================================
-- 12. ⚠️ CORRE ESTO DESPUÉS DE ENTRAR POR PRIMERA VEZ CON GOOGLE
--     Hasta que exista tu membresía, la app se verá vacía. Eso es correcto:
--     es RLS funcionando.
--
--     Descomenta y ejecuta:
--
-- insert into public.memberships (user_id, association_id, role)
-- select id, '11111111-1111-1111-1111-111111111111', 'dirigencia'
--   from auth.users
--  where email = 'TU_CORREO@gmail.com'
-- on conflict do nothing;
--
--     Para la prueba #5 del plan (aislamiento entre asociaciones), entra con
--     una SEGUNDA cuenta de Google y ligala a la asociación 2222...:
--     debe ver cero filas de la asociación 1111....
-- ============================================================================


-- ============================================================================
-- 13. GRANTS explícitos al rol authenticated
--
--     Motivo: este proyecto tiene desactivado "Automatically expose new
--     tables" en la configuración de Supabase. Eso significa que crear una
--     tabla NO le da automáticamente privilegio SELECT/INSERT/UPDATE/DELETE
--     al rol `authenticated` — a diferencia del comportamiento por defecto.
--     Sin este bloque, toda consulta falla con:
--
--         42501  permission denied for table <nombre>
--
--     y ese error ocurre ANTES de que Postgres llegue a evaluar Row Level
--     Security. Un 42501 se ve, desde la app, exactamente igual que "RLS negó
--     la fila" (cero filas / consulta rechazada), pero es una capa distinta y
--     anterior: falta de permiso sobre la tabla, no una política que niega.
--     Si recreas esta base desde cero y omites este bloque, te topas con el
--     mismo muro.
--
--     `anon` no recibe ningún GRANT aquí. Su única puerta de lectura sigue
--     siendo `dossier_by_token` (security definer), nunca las tablas
--     directamente — así queda la cláusula sombra intacta también a nivel de
--     permisos, no solo de política.
-- ============================================================================

-- associations y memberships: solo lectura. La dirigencia no puede darse de
-- alta ni cambiar de asociación por su cuenta; eso lo hace quien administra.
grant select on public.associations, public.memberships to authenticated;

-- las seis tablas operativas: lectura y escritura, siempre acotada después
-- por RLS a la fila donde is_member(association_id) es verdadero.
grant select, insert, update, delete on
  public.units,
  public.shifts,
  public.pings,
  public.inferred_stops,
  public.run_metrics,
  public.share_grants
to authenticated;

-- pings usa bigserial (id): nextval() necesita usage sobre su secuencia.
grant usage on all sequences in schema public to authenticated;
