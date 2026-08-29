-- =====================================================================
-- CORRECCIONES DE PUESTO Y UNA BAJA · confirmadas por David el 2026-08-29
--
--   · Francisco Cendejas ....... ya no trabaja  -> se desactiva
--   · Jose de Jesus Zavala ..... Vendedor RD
--   · Juan Manuel Espinoza ..... Encargado de TLMK
--   · Manuel Medina ............ Auxiliar de Reparto
--   · Nery Salvador Ramirez Chavolla ... ya no trabaja -> se desactiva
--
-- --- LO QUE ESTE ARCHIVO DESTAPA ------------------------------------------
-- Manuel Medina NO es un dato mal capturado: es un error MIO. La nomina lo
-- trae como "Auxiliar de Chofer" y yo mapee ese texto a `auxiliar-chofer`, que
-- en el organigrama cuelga de CEDIS y reporta a Coordinacion de Logistica. Pero
-- el esta en Tlmkt Canindo, que es Operaciones de Zona, y ahi el puesto que
-- corresponde es `aux-reparto`.
--
-- El mismo texto de nomina significa dos puestos distintos segun el centro, y
-- yo lo resolvi mirando solo el texto. Hay otro caso identico en la misma
-- situacion -CHAVERO NIÑO JHAROL STED y CASAS MENDOZA CESAR, tambien en Tlmkt
-- Canindo con "Auxiliar de Chofer"- pero NO se tocan aqui: David confirmo a
-- Manuel Medina, no a ellos. Quedan senalados para preguntar, porque corregir
-- por analogia es como se cometio el error original.
--
-- --- SOBRE LA BAJA --------------------------------------------------------
-- Ni Francisco Cendejas ni Nery Chavolla aparecen en la nomina, lo que encaja
-- con que ya no trabajen. Se DESACTIVAN, no se borran: su historial de tareas es
-- el registro de lo que hicieron mientras estuvieron, y borrarlo dejaria huecos
-- en las mediciones de meses ya cerrados. Un usuario inactivo no recibe tareas
-- nuevas y no cuenta para la cobertura, que es lo que se busca.
--
-- A Nery se le busca por 'chavolla', que es apellido raro -no aparece ni una vez
-- en las 190 filas de la nomina-. Si saliera mas de un candidato, el log lo
-- dice y no se toca a nadie mas: desactivar a quien si trabaja le quita el
-- acceso, y eso se nota tarde.
--
-- Idempotente. Cada bloque dice en el log cuantos encontro y cuantos cambio.
-- =====================================================================

do $$
declare
  r record;
  n_cand bigint;
  n_hecho bigint;
begin
  -- ── Cambios de puesto ──────────────────────────────────────────────────
  -- Se exigen TODAS las palabras de la llave, no una: en 190 personas hay dos
  -- "Juan Manuel" y varios "Medina", y darle a uno el puesto del otro le quita
  -- sus tareas y le entrega las que no le tocan.
  for r in
    select * from (values
      (array['zavala','jose','jesus']::text[], 'vendedor-rd',                'Vendedor RD',          'Jose de Jesus Zavala'),
      (array['espinoza','juan','manuel']::text[], 'coordinador-operaciones-zona', 'Encargado de TLMK', 'Juan Manuel Espinoza'),
      (array['medina','manuel']::text[],       'aux-reparto',                'Auxiliar de Reparto',  'Manuel Medina')
    ) as t(llave, puesto_id, cargo_txt, quien)
  loop
    select count(*) into n_cand
      from mdtask_usuarios u
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;

    -- Con mas de un candidato no se toca a nadie, igual que en las bajas. Dar
    -- el puesto a quien no es le entrega tareas que no le tocan y le esconde
    -- las suyas: es el mismo dano por partida doble.
    if n_cand > 1 then
      raise notice '[039] % : % candidatos con % — NO se cambia a nadie, hay que resolverlo a mano.',
        r.quien, n_cand, r.llave;
      continue;
    end if;

    -- Aqui SI se pisa el puestoId anterior: David lo confirmo de viva voz, y su
    -- palabra vale mas que lo que dedujo el cruce de la nomina.
    update mdtask_usuarios u
       set cargo = r.cargo_txt,
           datos = coalesce(u.datos, '{}'::jsonb)
                   || jsonb_build_object('puestoId', r.puesto_id,
                                         '_puestoAsignadoEn', '2026-08-29',
                                         '_puestoOrigen', 'confirmado por David')
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;
    get diagnostics n_hecho = row_count;

    raise notice '[039] % -> %: % candidato(s), % actualizado(s)',
      r.quien, r.puesto_id, n_cand, n_hecho;

    if n_cand = 0 then
      raise notice '[039] AVISO: nadie coincide con % . Revisar como se escribe en la app.', r.llave;
    end if;
  end loop;

  -- ── Bajas ──────────────────────────────────────────────────────────────
  for r in
    select * from (values
      (array['cendejas','francisco']::text[], 'Francisco Cendejas'),
      (array['chavolla']::text[],             'Nery Salvador Ramirez Chavolla')
    ) as t(llave, quien)
  loop
    select count(*) into n_cand
      from mdtask_usuarios u
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;

    -- Con mas de un candidato NO se desactiva a nadie. Quitarle el acceso a
    -- quien si trabaja es un error que se descubre tarde y de mala manera:
    -- cuando esa persona llega a trabajar y no puede entrar.
    if n_cand > 1 then
      raise notice '[039] % : % candidatos con % — NO se desactiva a nadie, hay que resolverlo a mano.',
        r.quien, n_cand, r.llave;
      continue;
    end if;

    update mdtask_usuarios u
       set activo = false,
           datos = coalesce(u.datos, '{}'::jsonb)
                   || jsonb_build_object('_bajaEn', '2026-08-29',
                                         '_bajaMotivo', 'ya no trabaja (confirmado por David)')
     where u.activo is not false
       and mdtask_tokens_nombre(u.nombre) @> r.llave;
    get diagnostics n_hecho = row_count;

    raise notice '[039] % (baja): % candidato(s), % desactivado(s)', r.quien, n_cand, n_hecho;
    if n_cand = 0 then
      raise notice '[039] AVISO: no se encontro a % activo. Puede que ya estuviera dado de baja.', r.quien;
    end if;
  end loop;
end $$;
