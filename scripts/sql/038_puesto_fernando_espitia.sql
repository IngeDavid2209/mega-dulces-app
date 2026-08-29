-- =====================================================================
-- FERNANDO ESPITIA · Anaquelista
--
-- Lo confirmó David el 2026-08-29. En la nómina ya venía bien
-- ("ESPITIA VACA FERNANDO", Anaquelista, 8 Esquinas), asi que el dato nunca
-- estuvo mal: lo que fallo fue que su ficha de la app no quedo sellada.
--
-- POR QUE NO LO AGARRO LA 037. No se sabe con certeza, y conviene decirlo:
-- con la regla de aquella migracion deberia haber ganado 2 palabras a 1 sobre
-- el otro Fernando de 8 Esquinas. La explicacion mas probable es que su cuenta
-- se creo DESPUES del 28 de agosto, que es cuando la 037 corrio una sola vez.
--
-- Si es eso, no es un caso suelto: a toda persona que se dé de alta a partir de
-- ahora le va a pasar lo mismo, porque no hay nada que selle el puesto de forma
-- continua. La 037 fue una pasada, no un mecanismo. Esta migracion tampoco lo
-- arregla — solo destraba a Fernando— y queda anotado para atacarlo aparte.
--
-- Idempotente y conservadora:
--   · Solo toca a quien NO tenga ya un puestoId. Un puesto capturado a mano
--     manda sobre esto.
--   · Exige las DOS palabras (espitia Y fernando). Con "8 Esquinas" hay otro
--     Fernando —CALLEJAS VACA LUIS FERNANDO— y confundirlos le daria a uno las
--     tareas del otro.
--   · Deja sello de origen, para poder rastrear despues de donde salio.
-- =====================================================================

do $$
declare
  n_asignados bigint := 0;
  n_candidatos bigint := 0;
begin
  -- Cuantos coinciden, antes de tocar nada. Si sale 0, el nombre en la app se
  -- escribe distinto y hay que verlo a mano: mejor enterarse por el log que
  -- creer que se aplico.
  select count(*) into n_candidatos
    from mdtask_usuarios u
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['espitia','fernando']::text[];

  update mdtask_usuarios u
     set cargo = 'Anaquelista',
         datos = coalesce(u.datos, '{}'::jsonb)
                 || jsonb_build_object('puestoId', 'anaquelista',
                                       '_puestoAsignadoEn', '2026-08-29',
                                       '_puestoOrigen', 'confirmado por David')
   where u.activo is not false
     and mdtask_tokens_nombre(u.nombre) @> array['espitia','fernando']::text[]
     and coalesce(u.datos->>'puestoId', '') = '';
  get diagnostics n_asignados = row_count;

  raise notice '[038] Fernando Espitia: % candidato(s) por nombre, % asignado(s) como anaquelista',
    n_candidatos, n_asignados;

  if n_candidatos = 0 then
    raise notice '[038] AVISO: nadie coincide con espitia+fernando. Revisar como esta escrito su nombre en la app.';
  end if;
end $$;
