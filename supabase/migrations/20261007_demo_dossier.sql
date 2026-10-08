-- ============================================================================
-- MIGRACIÓN 2026-10-07 — /demo deja de depender de DEMO_DOSSIER_TOKEN
--
-- Aplicada el 2026-10-07 en el SQL Editor de Supabase, en TRES tandas
-- separadas (marcadas abajo), sin begin/commit y con etiqueta de dólar
-- propia ($demo_fn$): el editor no procesó un solo bloque con begin/commit
-- envolviendo una función plpgsql (ver DECISIONS.md, Session 15). Editar
-- schema.sql no aplica nada a una base ya creada; esto sí.
--
-- Qué hace:
--   1. Agrega share_grants.is_demo (false por defecto).
--   2. Índice único parcial: como máximo UNA fila marcada como demo, vigente
--      o revocada. Así /demo nunca tiene que elegir entre dos.
--   3. Quita a `authenticated` el permiso de escribir is_demo: la dirigencia
--      sigue concediendo y revocando igual que antes, pero no puede marcar
--      (ni desmarcar) una concesión como demo. Eso solo se hace aquí, a mano.
--   4. Crea demo_dossier(), que /demo llama sin token. Para el caso vigente
--      delega en dossier_by_token, la misma puerta de /expediente/[token].
--   5. Marca la concesión de demostración actual.
--
-- dossier_by_token NO cambia: un token revocado y uno inexistente siguen
-- devolviendo exactamente lo mismo (null).
-- ============================================================================

-- ---------------------------------------------------------------- TANDA 1
-- 1. columna
alter table public.share_grants
  add column if not exists is_demo boolean not null default false;

-- 2. como máximo una concesión de demostración
create unique index if not exists share_grants_one_demo_idx
  on public.share_grants ((true))
  where is_demo;

-- 3. privilegios por columna: authenticated no puede escribir is_demo.
--    Un GRANT a nivel tabla cubre todas las columnas y no se puede recortar
--    con un REVOKE por columna, así que se retira el de tabla y se otorga
--    solo lo que la app usa (app/shareActions.ts: insert de estas tres
--    columnas; update de revoked_at).
revoke insert, update on public.share_grants from authenticated;
grant insert (association_id, recipient_label, granted_by)
  on public.share_grants to authenticated;
grant update (revoked_at)
  on public.share_grants to authenticated;

-- ---------------------------------------------------------------- TANDA 2
-- 4. lectura de la demo
--    Devuelve uno de:
--      {"estado": "sin_configurar"}                  ninguna fila con is_demo
--      {"estado": "revocada", "revocada_el": ...}    la fila existe, revocada
--      {"estado": "ok", "expediente": {...}}         vigente
--    Distinguir aquí no abre ningún sondeo: no recibe token, solo informa
--    el estado de una única concesión marcada en la base.
create or replace function public.demo_dossier()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $demo_fn$
declare
  g public.share_grants;
begin
  select * into g
    from public.share_grants
   where is_demo;

  if not found then
    return jsonb_build_object('estado', 'sin_configurar');
  end if;

  if g.revoked_at is not null then
    return jsonb_build_object('estado', 'revocada', 'revocada_el', g.revoked_at);
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'expediente', public.dossier_by_token(g.token)
  );
end;
$demo_fn$;

grant execute on function public.demo_dossier() to anon, authenticated;

-- ---------------------------------------------------------------- TANDA 3
-- 5. marca la concesión actual ("Vista de demostración académica (pública,
--    solo lectura)"). Debe reportar UPDATE 1; si reporta 0, el token no
--    coincide y la demo queda en "sin_configurar".
update public.share_grants
   set is_demo = true
 where token = '6a8036e635f49eb406d9e942f6d85a92300fc5bb823aef4b';

-- Verificación (córrela después, aparte):
--   select recipient_label, revoked_at, is_demo from public.share_grants where is_demo;
--   select public.demo_dossier() ->> 'estado';   -- debe decir: ok
