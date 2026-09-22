#!/usr/bin/env node
/**
 * 🚚 ¿LLEGÓ EL DESPLIEGUE? — marcadores contados en TODO lo que se sirve
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA PREGUNTA QUE CONTESTA
 * ═══════════════════════════════════════════════════════════════════════════
 * NO «¿corrió `railway up`?» ni «¿cambió la fecha del ngsw?». Esas dos dan
 * verde con el código viejo servido — y ya dieron tres falsos positivos en un
 * día. La pregunta es:
 *
 *     ¿EL CÓDIGO NUEVO ESTÁ EN LOS ARCHIVOS QUE EL NAVEGADOR DESCARGA?
 *
 * ─── LAS TRES TRAMPAS QUE ESTO EVITA, todas cobradas antes ──────────────────
 *
 * 1. BUSCAR EN EL ARCHIVO EQUIVOCADO. Las pantallas van en chunks *lazy*:
 *    buscar un marcador en `main-*.js` da CERO por mirar donde no está. Aquí se
 *    recorren TODOS los archivos de código que declara el `ngsw.json`.
 *
 * 2. EL HOST ESCRITO DE MEMORIA. `mdtask.up.railway.app` no existe. El edge de
 *    Railway responde 404 CON CUERPO (101 bytes de JSON y `x-railway-fallback`)
 *    cuando el host no tiene servicio detrás, así que un conteo sobre eso no
 *    falla: solo no encuentra nada. El host se pasa por argumento y se lee del
 *    repo, y el script ABORTA si el `ngsw.json` no es JSON o viene enano.
 *
 * 3. EL MARCADOR QUE YA VALÍA 1. Un marcador que existía antes del cambio da
 *    verde sin desplegar nada. Por eso cada marcador se declara con lo que se
 *    espera ANTES y DESPUÉS, y el script exige que el conjunto incluya:
 *      · al menos un marcador NUEVO (0 antes, >0 después), y
 *      · al menos un CONTROL presente en las dos (prueba que el recorrido
 *        alcanza el chunk correcto: sin él, un cero se lee como «no llegó»
 *        cuando puede ser «no busqué donde está»).
 *
 *   node scripts/verificar-despliegue.js <host>
 *   node scripts/verificar-despliegue.js mdtask-production-ed88.up.railway.app
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = process.argv[2];
const DIST = path.join(__dirname, '..', 'dist', 'mega-dulces-app', 'browser');

/**
 * Los marcadores. `nuevo: true` = tiene que pasar de 0 a >0 con este
 * despliegue. `control: true` = ya existía y tiene que seguir >0: es lo que
 * prueba que el recorrido llega al chunk del organigrama.
 */
const MARCADORES = [
  // ── COMO SE ELIGE UN MARCADOR, que es la leccion del 13/sep/2026 ─────────
  // Para la Fase 2.1 el primer candidato fue `no_ejecutado`, el estado nuevo de
  // la regla. Parecia inmejorable y estaba MAL: medido contra produccion ANTES
  // de desplegar YA VALIA 2 — esa cadena vive desde hace dias en
  // `tablero-direccion.util.ts` (el modelo de 5 causas), asi que habria dado
  // verde sin desplegar nada. `justificado` tampoco servia: 6 archivos en HEAD.
  //
  // La raiz: un cambio de LOGICA PURA no introduce ninguna cadena propia, y el
  // minificador ademas se come los nombres de funcion (`estadoItem` -> 0 en el
  // bundle) aunque respete los literales de cadena. Por eso los marcadores
  // buenos acaban siendo clases CSS de algo que de verdad se pinta, y cada una
  // se valida en LAS DOS DIRECCIONES: inexistente en HEAD, presente en el dist.
  //
  // EL NUEVO DE ESTE DESPLIEGUE va SIEMPRE en esta linea, y los de despliegues
  // anteriores bajan a control. Mantener ese orden importa: dos veces hoy el
  // comentario se quedo describiendo el marcador ANTERIOR, y un comentario que
  // narra otra cosa que la linea de abajo es doctrina falsa en dos semanas.
  // 14/sep/2026 (6) · LA NORMA COMO DATO (Fase 7 · paso 7.1a). La pantalla
  // donde Direccion captura las tareas de los 70 puestos sin manual (38 con
  // gente, 104 personas). Validado en LAS DOS DIRECCIONES antes de subir:
  // `git grep mp-propias HEAD` -> 0 ocurrencias · dist/ -> 9, en un chunk lazy.
  //
  // ⚠ LO QUE ESTE MARCADOR *NO* PRUEBA: que alguien pueda guardar una tarea.
  //   Eso necesita la migracion 060 aplicada (su `raise notice` en el log) y
  //   el endpoint montado (401 sin token). El marcador solo dice que el bundle
  //   con la pantalla se sirvio — la misma distincion que el emisor del 14/sep.
  // 15/sep/2026 · EL MANUAL DEJA DE ENTREGARSE UNA VEZ POR CADA AREA DE LA
  // FICHA. Un cambio de LOGICA PURA no aporta cadena propia —la raiz de
  // siempre— y se comprobo MIDIENDO: con el arreglo ya compilado, los 26
  // marcadores daban el MISMO numero en dist/ y en produccion, o sea que el
  // despliegue habria sido inverificable. El marcador honesto acabo siendo el
  // motivo del recorte, y esa linea hacia falta igual: un recorte mudo se lee
  // como un bug. Salio de resolver un problema real, no al reves.
  // Validado en las dos direcciones: 0 en HEAD, 1 en el dist/.
  // 17/sep/2026 · EL BUSCADOR EN LAS CUATRO BANDEJAS Y EL AGRUPADOR POR
  // SUCURSAL. Reporte de David con captura: tecleo «la piedad abastos» en
  // «Enviadas del equipo» y siguio viendo Padre Hidalgo con el contador en
  // (94). Dos defectos: el filtro de texto vivia dentro de
  // `checklistsFiltrados` (solo Pendientes), y el boton de agrupar tenia dos
  // condiciones CONTRADICTORIAS, asi que no se pintaba nunca en ninguna
  // combinacion posible.
  // Validado en LAS DOS DIRECCIONES antes de subir: `git grep cl-grupo-suc
  // HEAD` -> 0 archivos · dist/ -> 9 ocurrencias.
  //
  // ⚠ LO QUE ESTE MARCADOR *NO* PRUEBA: que el buscador filtre. Es la clase
  //   del encabezado de sucursal, o sea que el bundle con el codigo nuevo se
  //   sirvio. Que recorte lo prueba `scripts/prueba-buscador-y-agrupacion.js`
  //   en el DOM, y que se vea bien lo prueba una persona abriendo la app.
  // 17/sep/2026 · BAJA A CONTROL: medido contra produccion antes de este
  // despliegue, ya vale 9. Dejarlo como `nuevo` habria dado verde SIN
  // comprobar nada del cambio de hoy, que es justo el falso positivo que este
  // archivo lleva tres semanas evitando.
  { txt: 'cl-grupo-suc', control: true, que: 'el encabezado de sucursal en la lista de tareas' },

  // 17/sep/2026 · LA LISTA SE PLIEGA: cada encabezado es un boton que se
  // desglosa (instruccion de David: «quiero que este dentro de botones y de
  // ahi se desglose»). Los dos marcadores son de CSS porque el minificador se
  // come los nombres de metodo: `alternarSuc` habria sido un FALSO POSITIVO
  // —ya vale 2 en produccion, porque es prefijo de `alternarSucursal`, que
  // existe en Bloques y en Venta de Promos desde hace meses— y eso se vio
  // midiendo, no leyendo. Validados en LAS DOS DIRECCIONES antes de subir:
  // produccion 0 y 0 · dist/ 4 y 7.
  // Los dos del plegado bajan a CONTROL: ya valen en produccion, asi que
  // dejarlos como `nuevo` habria dado verde sin comprobar nada de hoy.
  { txt: 'cl-grupo-flecha', control: true, que: 'la flecha que gira al abrir un bloque' },
  { txt: 'cl-grupo-abierto', control: true, que: 'el estado abierto del bloque plegable' },
  // ── 18/sep/2026 · el envio de la anaquelista ───────────────────────────
  // Los tres son CSS y texto literal, no nombres de funcion: el minificador se
  // come `motivoSinPrueba` pero respeta las clases y las cadenas. Validados en
  // las dos direcciones antes de subir: 4/11/3 en dist, 0 en produccion.
  // Los tres del envio bajan a CONTROL: ya valen en produccion desde el
  // despliegue de esta misma tarde.
  { txt: 'sp-modal', control: true, que: 'el modal que sustituye al confirm() del navegador' },
  { txt: 'cl-reloj', control: true, que: 'el aviso de hora, una vez por tarea' },
  { txt: 'no van a contar como hechos', control: true,
    que: 'lo que se le dice a la persona ANTES de que acepte' },
  // ── 18/sep/2026 · el arbol arranca en su puesto tambien con trabajo ─────
  // ⚠ EL ARREGLO DEL ARBOL ES LOGICA PURA Y NO TIENE MARCADOR PROPIO: no
  // introduce ninguna cadena, y el minificador se come los nombres de variable
  // (`llevanALaRaiz` da 0 en el bundle). Es el mismo caso que la Fase 2.1. Lo
  // que se marca es el titulo contextual, que viaja en el MISMO commit y en el
  // mismo chunk: si llega, llego el arreglo. Se dice asi de claro para que
  // nadie lea este marcador como una comprobacion del enraizado — eso lo
  // prueba `prueba-rama-visible-con-datos.js`, en local y con su control.
  { txt: 'org-titulo-mio', control: true, que: 'el titulo del arbol dice de quien es' },
  // ── 18/sep/2026 · Capa 1: la linea que contesta la pregunta ─────────────
  { txt: 'org-resumen', control: true, que: 'la linea de resumen del equipo' },
  { txt: 'No hay entregas pendientes', control: true,
    que: 'el vacio que NO dice «todo entregado», porque seria mentira' },
  // ── 19/sep/2026 · UNA sola definicion de «vencida» ─────────────────────
  // ⚠ Unificar la regla es LOGICA PURA y no introduce ninguna cadena propia
  // (`esChecklistVencido` lo minifica el bundler). Lo que se marca es el
  // rotulo de la columna, que viaja en el mismo commit y el mismo chunk: si
  // llega, llego la regla. Que la regla HAGA lo que dice lo prueban las 9
  // aserciones nuevas y el contraste medido -el mismo fixture pasa de «6 a
  // tiempo» a «6 vencidas»-, no este marcador.
  // 19/sep/2026 · los cinco guards de ruta que faltaban. Cerrar una ruta es
  // LOGICA PURA y no introduce ninguna cadena propia (los nombres de los guards
  // los come el minificador), asi que el marcador es la linea de consola que el
  // guard escribe al rebotar — y esa linea hacia falta igual: sin ella, quien
  // sigue un enlace viejo aterriza en sus tareas sin ninguna pista de por que.
  //
  // Validado en las DOS direcciones antes de subir: 1 en dist/ (chunk lazy),
  // 0 en produccion. Lo que este marcador prueba es que el codigo llego; que
  // los guards GATEEN lo prueban las 48 mediciones en el DOM de
  // `prueba-guards-ruta.js` y sus dos controles negativos.
  // 19/sep/2026 (tarde) · el rango deja de salir de «tiene alguien debajo».
  // Otra vez logica pura sin cadena propia, asi que el marcador es la linea que
  // `estructuraGuard` escribe al rebotar — y hacia falta igual: ESTE cambio es
  // el que empieza a rebotar gente de /plantilla, y hasta hoy rebotaba mudo.
  // Se distingue del mensaje de los otros cinco guards a proposito: alla falta
  // una bandera, aqui falta RANGO, y eso es lo que hay que poder leer.
  // Validado en las dos direcciones: 1 en dist/, 0 en produccion (66 archivos,
  // 4.47 MB, 0 fallos de lectura — sin esa cifra el cero no vale).
  // 20/sep/2026 · MANTENIMIENTO y SISTEMAS dejan de verse desde otra sucursal.
  // Otra vez logica pura; el marcador es el contador que el recorte deja en el
  // diagnostico inline, y hacia falta igual: el recorte es MUDO en pantalla, y
  // una Encargada que pasa de doce ordenes a dos lo va a reportar como que se
  // perdieron. Validado en las dos direcciones: 1 en dist/, 0 en produccion
  // (66 archivos, 4.47 MB, 0 fallos de lectura).
  // 20/sep/2026 (tarde) · «Enviadas» pasa a mostrar SOLO EL DIA. Pedia treinta
  // dias y no recortaba la fecha, mientras «Pendientes» pedia desde hoy: las
  // dos bandejas en escalas distintas, que es lo que David vio.
  // El marcador es el texto del vacio, y hacia falta igual: decia «no hay
  // tareas enviadas en los ultimos 30 dias», que desde hoy es FALSO y mandaria
  // a buscar un problema que no existe. Validado en las dos direcciones:
  // 1 archivo en dist/, 0 en produccion (67 archivos, 0 fallos de lectura).
  // 21/sep/2026 · «Operacion de sucursal del turno» reescrita (7 puntos -> 5), el
  // Auxiliar de Encargado recibe el manual del Encargado, y DOS PUNTOS DEJAN DE
  // PEDIR FOTO: su prueba es lo escrito, y lo escrito cuenta en el porcentaje.
  //
  // El marcador es la clase del bloque nuevo, y se eligio SIN VOCALES
  // ACENTUADAS a proposito: el bundle las escapa y un ancla con acento no pega
  // -seria un no-op, y un no-op da verde (14/sep)-. Validado en las dos
  // direcciones ANTES de subir: 1 archivo en dist/, 0 en el repo en HEAD.
  // 21/sep/2026 (tarde) · La operacion PROPIA del Auxiliar de Encargado (8 puntos,
  // «cubre, no manda») y el manual nuevo del Surtidor de Sucursal (9 puntos, que
  // surte LISTAS DE PASILLO). Los dos ids son cadenas literales del catalogo, que
  // el minificador respeta, y ninguno lleva vocal acentuada -el bundle las escapa
  // y un ancla con acento no pega-. Validados en las dos direcciones ANTES de
  // subir: 2 archivos en dist/, 0 en el repo en HEAD.
  // 22/sep/2026 · «no los deja subir sus tareas». El guardado esperaba a
  // Firestore -cuyo `setDoc` NO rechaza sin red: deja la promesa pendiente- y
  // por eso NUNCA llegaba a escribir en Postgres, que es de donde lee la app.
  // Medido en el DOM: 0 POST antes, 2 despues.
  //
  // LOS TRES SON CADENAS QUE EL MINIFICADOR RESPETA (una clase de CSS, un
  // literal de texto y un nombre de propiedad de objeto, que se conserva porque
  // viaja serializado a IndexedDB). Ninguno lleva vocal acentuada: el bundle
  // las escapa y un ancla con acento no pega, o sea un no-op, y un no-op da
  // verde (14/sep). Validados en las dos direcciones ANTES de subir:
  // 1, 1 y 2 archivos en dist/ · 0 en el repo en HEAD.
  // 22/sep/2026 (tarde) · LA KILEADORA. El puesto no existia como dato -0 en el
  // organigrama, 0 en la nomina, 0 de 149 fichas- aunque la operacion se nombraba
  // a diario («kileado» estaba en el vocabulario del dictado por voz). Se declara
  // el puesto y se le escribe su manual derivado, 1 tarea de 9 puntos.
  //
  // El marcador es el id literal de la tarea, que el minificador respeta, y no
  // lleva vocal acentuada -el bundle las escapa y un ancla con acento no pega:
  // seria un no-op, y un no-op da verde (14/sep)-. Validado en las dos
  // direcciones ANTES de subir.
  //
  // ⚠ ESTE MARCADOR PRUEBA QUE LA NORMA VIAJO, NO QUE SE ENTREGUE A NADIE:
  // ninguna ficha tiene todavia `puestoId: 'kileadora'`, asi que el emisor no
  // le reparte a nadie hasta que Capital Humano se lo asigne. Son dos cosas
  // distintas y conviene no leer una por la otra.
  // 22/sep/2026 (tarde, 2) · EL MANUAL LLEGA AL PUESTO `empaque`, que existia
  // con CERO tareas y una sola persona —la que abrio la app ese dia y no
  // recibio nada—. No se le escribe un manual propio: la MISMA tarea sirve a
  // los dos puestos, que es el patron del Checador.
  //
  // El marcador es el `documento` renombrado, que es la cadena que cambia y la
  // que la persona LEE en su checklist. Sin acentos en el trozo anclado.
  // Validado en las dos direcciones ANTES de subir.
  // 22/sep/2026 (tarde, 3) · BOTON DE BUSCAR ACTUALIZACION en el pie del menu.
  // Instruccion de David: «un boton de refresh para que esten refrescando la
  // pagina aunque la tengan descargada», «en un apartado en donde no estorbe».
  // Con la app instalada no hay barra del navegador donde pulsar recargar, y lo
  // que habia era automatico: se buscaba sola, pero la persona no podia pedirlo.
  //
  // Es una clase de CSS y no el nombre del metodo, porque el minificador se come
  // `buscarActualizacion` y respeta las clases. Sin vocal acentuada: el bundle
  // las escapa y un ancla con acento no pega — seria un no-op, y un no-op da
  // verde (14/sep). Validado en las dos direcciones ANTES de subir: 0 en HEAD,
  // 1 archivo en dist/.
  // BAJA A CONTROL el 22/sep: su commit (5e59698) es ANTERIOR al de kileo
  // (a776caa), que ya vale 1 en produccion — o sea que este marcador YA ESTABA
  // SERVIDO y, declarado como `nuevo`, habria dado verde sin comprobar nada de
  // este despliegue. Es la trampa que este archivo lleva un mes nombrando.
  { txt: 'md-refresco-btn', control: true,
    que: 'el boton de buscar actualizacion, en el pie del menu' },
  // El de hace un rato baja a CONTROL: ya vale en produccion.
  { txt: 'kileo y empaque', control: true,
    que: 'el manual sirve a los dos puestos y el documento lo dice' },
  // El de hace un rato baja a CONTROL: ya vale en produccion, y dejarlo como
  // `nuevo` daria verde sin comprobar nada de este despliegue.
  { txt: 'kileadora.operacion', control: true,
    que: 'el manual derivado de la Kileadora (la norma viaja; la entrega espera a que se asigne el puesto)' },

  // 22/sep/2026 (tarde) · LA VENTANA DE ENTREGA 06:00 -> 23:00, IGUAL PARA
  // TODAS. Instruccion de David con la tabla de lo que habia enfrente -NUEVE
  // horas distintas sobre 9 949 puntos de una semana-: «no las quiero asi, las
  // quiero de 6:00 am a 11:00 pm».
  //
  // Otra vez un cambio de LOGICA PURA sin cadena propia: lo unico nuevo que
  // llega al bundle es el objeto `VENTANA_MANUAL`, porque el minificador se
  // come el NOMBRE (`VENTANA_MANUAL` -> 0 en dist) pero respeta sus literales.
  // Validado en las dos direcciones ANTES de subir, recorriendo los 68
  // archivos del ngsw.json y no solo el index (leccion del 3/sep):
  //     inicio:"06:00"   dist 1  ·  produccion 0
  //     "23:00"          dist 1  ·  produccion 0
  //     cl-foto-pendiente (control)          produccion 5  <- el recorrido llega
  //
  // Van LOS DOS y no uno: son las dos mitades de la ventana, y el dia que solo
  // viajara una -la hora de fin sin la de inicio- el punto venceria bien y
  // seguiria diciendo «Sin horario», que es medio arreglo con cara de entero.
  { txt: 'inicio:"06:00"', control: true,
    que: 'la ventana ARRANCA a las 06:00 (hasta hoy el punto nacia con horaInicio null)' },
  { txt: '"23:00"', control: true,
    que: 'la ventana CIERRA a las 23:00, la misma hora para las 50 tareas del catalogo' },

  // ══════════════════════════════════════════════════════════════════════════
  //  22/sep/2026 (noche) · NUEVE PUNTOS RETIRADOS DEL MANUAL
  // ══════════════════════════════════════════════════════════════════════════
  // David nombro ocho puntos, uno por uno y con su texto literal, y al ver los
  // seis GEMELOS que quedaban añadio uno mas: «Escaleras en condicion segura»,
  // del checklist diario del Almacenista.
  //
  // ⚠ ES EL PRIMER PASO QUE RETIRA, Y ESTE ARCHIVO NO SABIA EXPRESARLO. Todos
  // los marcadores de arriba son de PRESENCIA: «esta cadena tiene que aparecer».
  // Aqui la mitad que importa es la contraria — que nueve textos DEJEN de estar
  // servidos— y con solo el marcador de version se probaria que el bundle viajo,
  // nunca que los puntos se fueron. De ahi el tipo `ausente`.
  //
  // El marcador de presencia es la VERSION, porque §5.4 obliga a subirla al
  // cambiar la norma y es lo unico nuevo que el bundle gana. Lleva el punto
  // medio ESCAPADO (`\xB7`), que es como el minificador lo emite: buscar el
  // caracter real da 0 EN EL PROPIO dist/ — comprobado, y es justo el no-op que
  // da verde (14/sep). Validado en las dos direcciones ANTES de subir,
  // recorriendo los 66 archivos de codigo del ngsw y no solo el index:
  //     1.2 \xB7 Septiembre 2026   dist 2  ·  produccion 0
  //     Evidencia enviada          dist 0  ·  produccion 1   <- tiene que irse
  //     No hice ajustes...         dist 0  ·  produccion 1   <- tiene que irse
  { txt: '1.2 \\xB7 Septiembre 2026', nuevo: true, minimo: 2,
    que: 'la version subio al retirar puntos: la norma se versiona, no se edita (§5.4)' },
  // LOS DOS QUE TIENEN QUE DESAPARECER. Se eligieron SIN VOCAL ACENTUADA a
  // proposito: de los nueve retirados, los otros siete llevan acento y el bundle
  // los escapa, asi que un ancla con tilde no pegaria nunca — y en una asercion
  // de AUSENCIA un ancla rota no falla: da el 0 que uno queria ver.
  { txt: 'Evidencia enviada', ausente: true,
    que: 'el punto que pedia una foto de que mandaste fotos' },
  { txt: 'No hice ajustes de inventario por cuenta propia', ausente: true,
    que: 'uno de los tres que se fueron de la operacion del Almacenista' },
  // EL CONTROL DE LAS DOS AUSENCIAS, y sin el no valen nada: es un GEMELO que
  // NO se retiro, del mismo tipo de dato (el texto de un punto del manual) y
  // tambien sin acentos. Si este apareciera en 0, los dos ceros de arriba
  // dirian «no se donde buscar», no «se fueron».
  { txt: 'Carretas despejadas o correctamente ubicadas', control: true,
    que: 'GEMELO que se queda (Bodeguero): prueba que el recorrido SI ve los puntos del manual' },

  { txt: 'copiar la tarea a la nube de respaldo', control: true,
    que: 'el tope de Firestore: el guardado ya no se cuelga antes de escribir en Postgres' },
  { txt: 'cl-foto-pendiente', control: true,
    que: 'la foto que no subio se ve y dice que no cuenta' },
  { txt: 'se cierra con una FOTO', control: true,
    que: 'tocar el punto ya dice que le falta, en vez de no hacer nada' },
  // Los dos de ayer bajan a control: YA VALEN en produccion, y dejarlos arriba
  // daria verde sin comprobar nada de hoy.
  { txt: 'auxiliar-encargado.operacion', control: true,
    que: 'la operacion propia del Auxiliar de Encargado' },
  { txt: 'surtidor-sucursal.operacion', control: true,
    que: 'el manual del Surtidor de Sucursal' },
  // Los dos del despliegue de esta mañana bajan a control: YA VALEN en
  // produccion, y dejarlos arriba daria verde sin comprobar nada de este.
  { txt: 'cl-escrito', control: true,
    que: 'el cuadro de texto y el listado de los puntos sin foto' },
  { txt: 'evidenciaEscrita', control: true,
    que: 'la regla que hace que lo escrito cuente en el porcentaje' },
  // El del despliegue anterior baja a control: YA VALE en produccion, y
  // dejarlo arriba habria dado verde sin comprobar nada de hoy.
  { txt: 'Sin entregas hoy', control: true,
    que: 'el historial de enviadas acotado al dia en curso' },
  // El del despliegue anterior baja a control: YA VALE en produccion.
  { txt: 'recortadasPorArea', control: true,
    que: 'el recorte de MANTENIMIENTO y SISTEMAS para los puestos de sucursal y zona' },
  // El del despliegue anterior baja a control: YA VALE en produccion.
  { txt: 'sin-rango-de-mando', control: true,
    que: 'el rango sale del nivel del puesto, no de quien cuelgue de ti' },
  // El del despliegue anterior baja a control: YA VALE en produccion.
  { txt: 'ruta-cerrada-para-tu-perfil', control: true,
    que: 'los 5 guards de /reportes, /cierre-mensual, /manual-puestos, /descansos y /tareas-asignadas' },
  // El del despliegue anterior baja a control: YA VALE en produccion, y
  // dejarlo como `nuevo` daria verde sin comprobar nada de hoy.
  { txt: 'org-slot-tarde', control: true, que: 'la columna «Tarde» en vez de «Venc.»' },
  // Los dos del despliegue anterior bajan a control: YA VALEN en produccion, y
  // dejarlos arriba daria verde sin comprobar nada de este.
  { txt: 'no son sitios con cuadrilla', control: true,
    que: 'el manual ya no se entrega una vez por cada area de la ficha' },
  { txt: 'mp-propias', control: true, que: 'la pantalla de captura de la norma' },
  // Los tres de anoche bajan a control: YA VALEN en produccion (medido tras el
  // railway up de las 23:16), y dejarlos arriba daria verde sin comprobar nada
  // de este despliegue.
  { txt: 'cat-manual', control: true, que: 'el modal para dar una tarea del manual' },
  // 14/sep/2026 (5) · el desglose del rol admin. Era `nuevo` del despliegue de
  // las 23:16 y salio verificado (0 -> 3): baja a control.
  { txt: 'pm-desglose', control: true, que: 'el desglose de lo que concede el rol admin' },
  // ⚠ ESTE NO ES LA MITAD QUE IMPORTA, Y HAY QUE DECIRLO. La emision de las
  // tareas del dia vive en el SERVIDOR (api/emitir-manual.js) y eso no deja
  // ninguna cadena en el bundle: lo que este marcador prueba es que el codigo
  // del navegador se sirvio, no que el emisor este emitiendo. La comprobacion
  // del emisor es su linea en el log de Railway:
  //     [emisor-manual] poll iniciado (cada N min). Ahora en America/Mexico_City: ...
  // Sin esa linea, el emisor NO arranco aunque este marcador salga en 1.
  //
  // Es una frase entera y no una clase CSS porque un cambio de logica pura no
  // introduce ningun identificador propio (la leccion de la Fase 2.1): los
  // nombres de funcion los minifica el compilador, los literales no.
  { txt: 'ninguna de sus tareas aplica en esa fecha', control: true, que: 'la regla de emision compartida por el navegador y el servidor' },
  // Era el nuevo del despliegue anterior; baja a control porque YA VALE en
  // produccion y dejarlo arriba daria verde sin comprobar nada de este.
  { txt: 'cl-bandeja', control: true, que: 'la bandeja de cuatro botones' },
  //
  // ⚠ `cl-chip-origen` SE QUITO DE ESTA LISTA, y no por limpieza: era el
  //   marcador NUEVO del despliegue de hace una hora y esa clase YA NO
  //   EXISTE — David retiro los chips de origen el mismo dia. Dejarlo como
  //   control habria dado 0 en lo servido y el verificador habria abortado
  //   diciendo «el recorrido no alcanza el chunk», que es una conclusion
  //   FALSA: el cero seria porque el codigo se borro a proposito. Es el
  //   corolario (e) de la §8.11 —un control caducado se sustituye en el
  //   MISMO commit que lo caduca— y van dos veces en dos dias.
  // 14/sep/2026 · EL ARBOL EN UN CELULAR. Era el `nuevo` del despliegue
  // anterior (otra sesion, commit 412547c, ya desplegado y verificado 0 -> 1).
  // BAJA A CONTROL, que es la regla de esta lista: un marcador que YA VALE 1 en
  // produccion da verde sin comprobar nada del despliegue de hoy. Es el caso
  // del 13/sep con `no_ejecutado`, y esta vez lo avisaron antes de que pasara.
  { txt: '46px 56px 38px', control: true, que: 'la rejilla de cifras del arbol en movil' },
  { txt: 'CEDIS', control: true, minimo: 78, que: 'el filtro de lugares con cuadrilla' },
  { txt: 'Sin sucursales', control: true, minimo: 4, que: 'la lista de sucursales sale de la ficha' },
  { txt: 'direccion-general', control: true, minimo: 10, que: 'Usuarios solo para el dueño y Direccion General' },
  { txt: 'a tu nombre', control: true, que: 'el arreglo de «Mis tareas»' },
  { txt: 'davidcisneros2209', control: true, minimo: 2, que: 'el super admin reconocido por correo' },
  // CADUCADO Y SUSTITUIDO el 13/sep: el control era el texto «No hay ninguna
  // sucursal que puedas ver», y el mismo despliegue que lo usaba de control LO
  // REESCRIBIO. Dio 0 y el verificador aborto — correctamente, porque no puede
  // saber si el cero es «no llego» o «ya no existe». Es el corolario (e) de la
  // §8.11, y la regla que trae: un control caducado se actualiza EN EL MISMO
  // COMMIT que lo caduca. Se cambia por la clase del contenedor, que no depende
  // de como este redactado el aviso de dentro.
  { txt: 'pa-vacio', control: true, que: 'el estado vacio del pase de lista' },
  { txt: 'apple-mobile-web-app-capable', control: true, que: 'el arreglo de iPhone' },
  { txt: 'Plantilla de sucursal', control: true, que: 'la entrada de menu en Definiciones' },
  { txt: 'org-fila-tarea', control: true, que: 'el desglose del manual en el arbol' },
  { txt: 'md-update', control: true, que: 'el aviso de version nueva' },
  { txt: 'plz-codigo', control: true, que: 'el login por plaza' },
  { txt: 'pl-accesos', control: true, que: 'la pantalla de accesos de plaza' },
  { txt: 'min-height:var(--tap-min)', control: true, que: 'el minimo tactil' },
  { txt: 'pa-sin_asignar', control: true, que: 'la pantalla de pase de lista' },
  // Los de antes, ahora controles. Cada uno fue el "nuevo" de su momento, y
  // juntos prueban que el recorrido alcanza los chunks lazy de esas pantallas.
  { txt: 'pl-plazas',    control: true, que: 'la generacion de plazas desde la plantilla' },
  { txt: 'pl-sinpuesto', control: true, que: 'la pantalla de plantilla' },
  { txt: 'pr-justif',    control: true, que: 'los justificados nombrados en pantalla' },
  // Controles: existian antes de este despliegue y deben seguir en pie. Viven
  // en chunks DISTINTOS (tablero, tarjeta, organigrama, index), asi que si uno
  // diera 0 seria por no haber recorrido ese chunk, no por no haber llegado.
  { txt: 'no_ejecutado',       control: true, que: 'el modelo de causas del tablero' },
  { txt: 'avatar texto',       control: true, que: 'la rejilla movil de la tarjeta' },
  { txt: 'org-destino',        control: true, que: 'el eje transversal' },
  { txt: 'md_rescate_arranque', control: true, que: 'el rescate del index' },
];

function abortar(motivo) {
  console.error('');
  console.error('[despliegue] ABORTA: ' + motivo);
  console.error('[despliegue] No concluyas de esta corrida.');
  process.exit(3);
}

function bajar(url) {
  return new Promise((ok, mal) => {
    https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return mal(new Error('HTTP ' + res.statusCode + ' en ' + url +
          (res.headers['x-railway-fallback'] ? ' (x-railway-fallback: el host no tiene servicio detrás)' : '')));
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => ok(d));
    }).on('error', mal);
  });
}

function contarEn(textos, aguja) {
  return textos.reduce((n, t) => n + (t.split(aguja).length - 1), 0);
}

(async () => {
  if (!HOST) abortar('falta el host. Léelo del repo, no de memoria: ' +
    'node scripts/verificar-despliegue.js mdtask-production-ed88.up.railway.app');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    abortar('no hay dist/ local. Hace falta para comparar «lo que debería estar» contra ' +
      '«lo que se sirve».');
  }

  // ── 1 · el ngsw.json, con su tamaño ANTES de concluir nada ──────────────
  const base = 'https://' + HOST;
  let ngsw;
  try { ngsw = await bajar(base + '/ngsw.json?t=' + Date.now()); }
  catch (e) { abortar('no pude leer el ngsw.json: ' + e.message); }
  console.log('[despliegue] host %s · ngsw.json %d bytes', HOST, ngsw.length);
  if (ngsw.length < 2000) {
    abortar('el ngsw.json trae solo ' + ngsw.length + ' bytes. El 404 del edge de Railway ' +
      'viene CON cuerpo, así que esto puede ser una página de error que no falla al grepear.');
  }
  let manifiesto;
  try { manifiesto = JSON.parse(ngsw); }
  catch (e) { abortar('el ngsw.json no es JSON: ' + ngsw.slice(0, 120)); }

  const rutas = Object.keys(manifiesto.hashTable || {})
    .filter((r) => r.endsWith('.js') || r.endsWith('.css'));
  if (rutas.length < 10) abortar('el ngsw declara solo ' + rutas.length + ' archivos de código.');

  // ── 2 · bajarlos TODOS. Uno ilegible invalida el conteo ─────────────────
  const cuerpos = [];
  let bytes = 0, fallos = 0;
  for (const r of rutas) {
    try {
      const c = await bajar(base + r);
      cuerpos.push(c); bytes += c.length;
    } catch (e) { fallos++; console.error('  ! no pude bajar %s: %s', r, e.message); }
  }
  if (fallos) abortar(fallos + ' de ' + rutas.length + ' archivos no se pudieron leer. ' +
    'Un marcador ausente sería indistinguible de un archivo que no bajó.');
  // El `index.html` NO está en el `hashTable` del ngsw, y el navegador SÍ lo
  // descarga: ahí vive el <script> inline del rescate de arranque. Dejarlo
  // fuera hacía que su marcador diera 0 por no haberlo buscado — que es
  // exactamente el falso cero que el control de esta herramienta destapó.
  try {
    const idx = await bajar(base + '/index.html?t=' + Date.now());
    cuerpos.push(idx); bytes += idx.length;
    console.log('[despliegue] index.html %d bytes', idx.length);
  } catch (e) { abortar('no pude leer el index.html: ' + e.message); }

  console.log('[despliegue] servido: %d archivos de código + index · %s MB',
    rutas.length, (bytes / 1048576).toFixed(2));

  // ── 3 · el dist/ local, la otra mitad de la comparación ─────────────────
  const locales = [];
  const recoger = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) recoger(p);
      else if (/\.(js|css|html)$/.test(e.name)) locales.push(fs.readFileSync(p, 'utf8'));
    }
  };
  recoger(DIST);
  // EL DESGLOSE, y no solo el total. Este numero sale MAS ALTO que el de
  // "servido" —69 contra 65 el 14/sep/2026— y sin explicarlo se lee como
  // «produccion esta cuatro archivos atras». No lo esta: aqui se cuentan
  // tambien el `index.html` y los tres service workers (`ngsw-worker.js`,
  // `safety-worker.js`, `worker-basic.min.js`), que el `hashTable` del ngsw no
  // declara. Comprobado: 65 + 1 + 3 = 69, cero archivos sobrantes de builds
  // viejos. Un numero sin su desglose se malinterpreta en dos semanas.
  console.log('[despliegue] dist/ local: %d archivos (los %d del ngsw + index + 3 service workers)',
    locales.length, rutas.length);

  // ── 4 · la tabla ────────────────────────────────────────────────────────
  console.log('');
  console.log('marcador                              dist/  servido  qué prueba');
  console.log('─'.repeat(88));
  const filas = MARCADORES.map((m) => {
    const enDist = contarEn(locales, m.txt);
    const enProd = contarEn(cuerpos, m.txt);
    console.log('%s %s %s %s',
      m.txt.padEnd(37), String(enDist).padEnd(6), String(enProd).padEnd(8), m.que);
    return { ...m, enDist, enProd };
  });
  console.log('─'.repeat(88));

  // ── 5 · las aserciones ──────────────────────────────────────────────────
  const fallas = [];
  const nuevos = filas.filter((f) => f.nuevo);
  const controles = filas.filter((f) => f.control);
  const ausentes = filas.filter((f) => f.ausente);
  if (!nuevos.length) abortar('no hay ningún marcador NUEVO declarado: nada probaría que llegó.');
  if (!controles.length) abortar('no hay ningún CONTROL declarado: un cero sería indistinguible ' +
    'de haber buscado donde el código no está.');

  for (const f of controles) {
    if (f.enProd === 0) {
      abortar('el CONTROL "' + f.txt + '" da 0 en lo servido, y ya existía antes de este ' +
        'despliegue. Eso no dice «no llegó»: dice que el recorrido NO alcanza el chunk donde ' +
        'vive el código. Cualquier otro cero de esta tabla es igual de sospechoso.');
    }
  }
  for (const f of nuevos) {
    // `minimo` para los cambios que NO introducen una cadena propia.
    //
    // Un cambio de logica pura no aporta marcador natural -el minificador se
    // come los nombres- y a veces la unica cadena que se puede mirar YA EXISTIA
    // en otro archivo. Paso el 13/sep con el correo del dueño: valia 1 en
    // produccion (la lista de exentos del modo mantenimiento) y con el cambio
    // pasa a 2. Sin poder contar, ese marcador habria dado "ya esta servido"
    // ANTES de desplegar — un falso positivo de los que esta herramienta
    // existe para evitar.
    const minimo = typeof f.minimo === 'number' ? f.minimo : 1;
    if (f.enDist === 0) {
      fallas.push('"' + f.txt + '" no está ni en el dist/ local: el marcador está mal elegido, ' +
        'no es que no haya llegado. Un marcador que vale 0 en el dist/ no puede validar nada.');
    } else if (f.enDist < minimo) {
      fallas.push('"' + f.txt + '" tiene ' + f.enDist + ' en el dist/ y se esperaban al menos ' +
        minimo + '. El `minimo` declarado no corresponde al build: ajústalo o revisa el cambio.');
    } else if (f.enProd < minimo) {
      fallas.push('"' + f.txt + '" (' + f.que + ') está en el dist/ (' + f.enDist +
        ') y en lo servido solo ' + f.enProd + ' de los ' + minimo +
        ' esperados: el despliegue todavía no llegó.');
    }
  }

  // ── las AUSENCIAS ────────────────────────────────────────────────────────
  //
  // Un paso que RETIRA no se prueba con presencia. Aqui se exige el 0 en las
  // dos mitades, y son dos preguntas distintas:
  //
  //   dist  > 0  ->  el retiro no se aplico al codigo. No es «no llego»: es que
  //                  el cambio no existe, y desplegar otra vez no lo arreglaria.
  //   prod  > 0  ->  se aplico y todavia no esta servido.
  //
  // La guardia que sostiene los ceros es el CONTROL de arriba: un gemelo del
  // mismo tipo de dato que SI tiene que aparecer. Sin el, un ancla mal escrita
  // -o un acento escapado- daria exactamente el 0 que uno esperaba ver, que en
  // una asercion de ausencia es la forma mas comoda de mentirse.
  for (const f of ausentes) {
    if (f.enDist > 0) {
      fallas.push('"' + f.txt + '" (' + f.que + ') sigue en el dist/ LOCAL (' + f.enDist +
        '): el retiro no se aplicó al código. Volver a desplegar no lo va a arreglar.');
    } else if (f.enProd > 0) {
      fallas.push('"' + f.txt + '" (' + f.que + ') ya no está en el dist/ pero sigue servido (' +
        f.enProd + '): el despliegue todavía no llegó.');
    }
  }

  console.log('');
  if (fallas.length) {
    console.error('✗ %d marcador(es) sin llegar:', fallas.length);
    for (const x of fallas) console.error('   · ' + x);
    process.exit(2);
  }
  console.log('✓ los %d marcadores nuevos están servidos, %d ausencias confirmadas, y los %d ' +
    'controles siguen en pie.', nuevos.length, ausentes.length, controles.length);
  console.log('  (%d archivos, %s MB recorridos)', rutas.length, (bytes / 1048576).toFixed(2));
})();
