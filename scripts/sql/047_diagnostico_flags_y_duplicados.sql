-- =====================================================================
-- DIAGNOSTICO · NO CAMBIA NADA
--
-- Dos preguntas, las dos de David, las dos con la misma disciplina: el numero
-- va acompanado de las cifras de las que sale. Un cero solo no es un resultado.
--
-- ─── 1. ¿ESTA DESPLEGADO EL ARREGLO DEL DOM? ─────────────────────────────
-- El arreglo de la app lenta tiene DOS MITADES INDEPENDIENTES, y confundirlas
-- lleva a medir la mitad equivocada:
--
--   a) CODIGO: el robot ya no enciende `permiteFotos` en cada punto.
--   b) DATO:   la migracion 046 apago la bandera en los checklists ya creados.
--
-- La (b) se aplico y se verifico en su momento (1844 puntos, 0 restantes). Pero
-- si la (a) no estuviera desplegada, los checklists de HOY volverian a nacer con
-- la bandera encendida y no habria nada que probar en el piso.
--
-- Por eso la consulta agrupa por fecha: lo que importa es la fila de hoy.
--
-- ─── 2. GUARDIAN DE FICHAS DUPLICADAS ────────────────────────────────────
-- Hoy van SEIS correcciones de identidad por nombre en un dia. Este guardian
-- busca el septimo antes de que alguien lo reporte: pares (sucursal, puesto) con
-- mas de una ficha ACTIVA.
--
-- Dos cajeras en la misma sucursal es normal. Dos Encargadas casi nunca lo es.
-- El guardian NO decide cual es: marca con ⚠ los puestos de mando y deja el
-- juicio a quien lee. Es una deteccion, no un veredicto — y por eso cabe dentro
-- del congelamiento de la §7: no es un modulo, es una consulta.
--
-- Solo LEE. Ni un UPDATE.
-- =====================================================================

do $$
declare
  r record;
  n bigint;
begin
  -- ── 1. La bandera permiteFotos, por fecha ──────────────────────────────
  raise notice '[047] --- puntos con boton de foto, por fecha (7 dias) ---';
  raise notice '[047] la fila de HOY es la que dice si el arreglo del robot esta desplegado';

  n := 0;
  for r in
    select c.fecha,
           count(*) as checklists,
           sum(jsonb_array_length(coalesce(c.datos->'items', '[]'::jsonb))) as puntos,
           sum((select count(*)
                  from jsonb_array_elements(coalesce(c.datos->'items', '[]'::jsonb)) i
                 where (i->>'permiteFotos')::boolean is true)) as con_boton_foto
      from mdtask_checklists c
     where c.fecha >= to_char(current_date - 7, 'YYYY-MM-DD')
       and coalesce(c.eliminado, false) = false
     group by c.fecha
     order by c.fecha
  loop
    n := n + 1;
    raise notice '[047]   % · checklists=% puntos=% con_boton_foto=%',
      r.fecha, r.checklists, r.puntos, r.con_boton_foto;
  end loop;

  -- El cero que no midio nada: si no hubo ni una fila, DECIRLO.
  if n = 0 then
    raise notice '[047] AVISO: cero filas en la ventana de 7 dias. Eso NO significa que la bandera este apagada: significa que no se leyo nada. No concluyas.';
  end if;

  -- ── 2. Guardian: pares (sucursal, puesto) con mas de una ficha activa ──
  raise notice '[047] --- fichas activas duplicadas por sucursal y puesto ---';

  n := 0;
  for r in
    with fichas as (
      select coalesce(u.datos->>'sucursal', u.datos->'sucursales'->>0, '(sin sucursal)') as sucursal,
             coalesce(u.datos->>'puestoId', '(sin puesto)')                              as puesto_id,
             u.nombre
        from mdtask_usuarios u
       where u.activo is not false
         and coalesce(btrim(u.nombre), '') <> ''
    )
    select sucursal, puesto_id,
           count(*) as fichas,
           string_agg(nombre, ' | ' order by nombre) as quienes,
           -- Pista, no veredicto: en los puestos de mando el duplicado casi
           -- siempre es un error de captura; en los operativos es lo normal.
           (puesto_id ~* 'encargado|jefe|jefatura|gerencia|coordinador|direccion|supervisor') as es_mando
      from fichas
     where puesto_id <> '(sin puesto)'
     group by sucursal, puesto_id
    having count(*) > 1
     order by (puesto_id ~* 'encargado|jefe|jefatura|gerencia|coordinador|direccion|supervisor') desc,
              count(*) desc
  loop
    n := n + 1;
    -- 5 marcadores para 5 argumentos. Antes decia '%%', que en raise notice es
    -- un % LITERAL, no un marcador: quedaban 4 para 5 y la migracion reventaba.
    raise notice '[047]  % · % · % · % fichas: %',
      case when r.es_mando then '[MANDO]' else '[operativo]' end,
      r.sucursal, r.puesto_id, r.fichas, r.quienes;
  end loop;

  if n = 0 then
    raise notice '[047] ningun par (sucursal, puesto) tiene mas de una ficha activa.';
  else
    raise notice '[047] % par(es) con ficha repetida. Los marcados MANDO son los que hay que mirar primero.', n;
  end if;
end $$;
