# MDTask — Contexto del proyecto para Claude Code

App de operación de **Mega Dulces de los Altos**: entrega y cobra las tareas del Manual
Corporativo de Operación a sucursales, CEDIS y áreas administrativas. En producción, con
gente entrando todos los días. Un solo desarrollador (David).

Este archivo es el contexto permanente del proyecto. **Léelo completo antes de proponer
cambios.** Está escrito a partir de una revisión estructural del repo (31/ago/2026) y de un
modelo operativo acordado con Dirección.

---

## 1. Cómo funciona y cómo se despliega

- **Frontend:** Angular 20 (standalone, signals), PWA con service worker.
- **Backend:** `server.js` (Express) monta ~60 handlers de `api/*.js`. Esos archivos eran
  funciones serverless de Vercel y se reutilizan sin reescribir: cada uno maneja su propio
  método, su CORS y su SQL.
- **Base de datos:** Postgres en Railway, **compartido con otras apps** — por eso todas las
  tablas de este proyecto llevan prefijo `mdtask_`. Queda Firestore residual (ver §3).
- **Segunda base, solo lectura:** `TALENTO_DATABASE_URL` (Mega Talento / RH) para horarios de
  sucursal. **Nunca escribir ahí**: de esa tabla cuelga el control de asistencia y la nómina.
- **Migraciones:** `scripts/sql/NNN_*.sql`, aplicadas en orden al arrancar por
  `scripts/db-migrate.js`, registradas en `_migraciones`. Idempotentes.
- **Despliegue:** `railway up`. **`git push` NO despliega.** Hasta que corre `railway up`, el
  cambio no existe para nadie.
- **Modo mantenimiento:** `src/app/shared/mantenimiento.util.ts` tapa la interfaz y deja
  `/api` viva (para que el bot de WhatsApp y los polls no se caigan). Sirve para cortes de
  migración, no para trabajar días enteros.
- **Procesos periódicos:** 4 polls arrancan dentro de `app.listen` en `server.js` (flotilla,
  tareas, bloques, pagos). Esto amarra la app a **una sola réplica**.
- **GitHub Actions:** `.github/workflows/robot.yml` corre `scripts/corte.js` el día 1 a las
  `0 3 1 * *`. **Ese cron es UTC**, así que en hora de México (UTC-6) dispara a las **21:00 del
  último día del mes anterior**, no a las 3:00 AM del día 1. Puede retrasarse por carga de
  GitHub, nunca adelantarse.
- **Para GitHub Actions, `git push` SÍ es el despliegue.** Actions lee los workflows
  programados de la **rama por defecto** (`main`). Un cambio al cron que esté commiteado pero
  sin subir no surte efecto. Es la excepción exacta a la regla de arriba: `railway up`
  despliega la app, `git push` a `main` activa o desactiva los workflows.

## 2. Convenciones del repo (respétalas)

- **Todo en español**: nombres, comentarios, mensajes de commit.
- **Los comentarios explican el POR QUÉ**, incluido lo que salió mal antes. Es la mejor parte
  de este repo. Mantén ese estilo: si arreglas algo que ya falló, deja constancia de qué
  fallaba y por qué esta solución lo evita.
- **Patrón de tabla:** columnas tipadas para lo buscable/ordenable + `datos jsonb` para el
  resto del documento.
- **CRUD repetitivo:** usa el factory `api/_crud.js`, no copies archivos.
- **Auth de endpoints:** `api/_auth.js` → `verificarToken(req)`.
- **Migraciones:** siempre con `raise notice` reportando a cuántas filas tocó. Una migración
  que solo dice "aplicada" no se puede auditar.
- **Ids publicados no se renombran nunca** (puestos, tareas de manual). Si algo se retira, se
  marca `vigente: false` y se conserva.
- **Rutas retiradas no se borran**: quedan como `redirectTo` (hay enlaces viejos en WhatsApp).
- **Una migración ya aplicada NO se edita.** Está registrada por nombre de archivo en
  `_migraciones`: editarla no cambia nada en la base y destruye el registro de lo que
  realmente corrió. Todo arreglo va en una migración nueva.
- **Commit selectivo, nunca `git commit -a` — y `git add -u` es lo mismo con otro
  nombre.** Agrega todo lo modificado y rastreado, así que basta un archivo sucio para
  que el commit contenga algo que su mensaje no menciona (pasó el 31/ago con
  `version.ts`). Siempre `git add` con rutas explícitas, una por una, aunque solo se vean
  tres archivos. El repo no tiene `.gitattributes` ni
  `core.autocrlf` configurado, así que según desde dónde se lea el árbol de trabajo puede
  aparecer completo como modificado (puro cambio CRLF/LF). Se agregan a mano los archivos del
  paso y nada más.

## 3. Los 8 hallazgos estructurales (estado: sin resolver)

1. **La organización no existe como dato.** No hay tablas de sucursal, zona, puesto ni ámbito.
   Se cruza por **nombre en texto** (`mdtask_checklists.store`, `usuarios.datos.sucursales[]`,
   `zonas.util.ts → POR_SUCURSAL`). **0 llaves foráneas en 36 tablas.** Un apellido mal escrito
   deja a alguien sin tareas en silencio.
2. **Dos bases vivas con escritura doble no atómica.** Las lecturas ya vienen de Postgres; las
   escrituras van a Firestore y luego a la API, "best-effort", sin transacción
   (`checklist.ts:1878` `guardarEnLaNube`). 22 archivos siguen importando `@angular/fire`.
   `api/_auth.js` mantiene doble esquema de sesión (JWT propio + respaldo Firebase).
3. **Permisos ad-hoc:** `rol` + `alcance` + 34 banderas `puedeXxx` + 7 guards por módulo.
   Los roles reales (Encargada, Gerente de Zona) no existen: se infieren.
4. **Componente dios:** `modules/dashboard/checklist/checklist.ts`, 4,420 líneas, sirve dos
   rutas (`/checklist` y `/tareas-manual`) según una bandera, con 32 escrituras a Firestore,
   subida a Cloudinary y un `fetch` a un Apps Script.
5. **El manual y el organigrama son código:** `tareas-manual.catalogo.ts` (70 KB),
   `organigrama.catalogo.ts` (21 KB), `nomina-puestos.ts` (33 KB). Capital Humano no puede
   operar su propio documento; cada cambio autorizado es un despliegue.
6. **Los relojes viven dentro del servidor web** (§1). El interruptor `AVISOS_APAGADOS=1`
   existe para taparlo a mano.
7. **Cero pruebas** (`find src -name '*.spec.ts'` → 0) sobre reglas que producen números de
   personas. 33 de 60 endpoints con `Access-Control-Allow-Origin: *`.
8. **Datos de personas dentro de migraciones** (`037_asignar_puestos.sql`, 25 KB).

**Y un blocker activo:** `scripts/corte.js` corre cada mes, lee Firestore y **borra**
checklists (`batch.delete`). Postgres no se entera. La divergencia crece sola cada mes.
El respaldo mensual que llega por correo sale de la base que ya no es la fuente de lectura.

**Dato medido (migración 045, 31/ago/2026):** los items que pasan como cumplidos *solo* por la
justificación son **1 punto en toda la empresa**. La distorsión de hoy es despreciable — pero la
regla sigue mal, y el día que la gente descubra que una nota cierra el checklist, los números se
inflan sin aviso. Por eso arreglarla **ahora es gratis** y después cuesta una conversación con
cada gerencia.

## 4. El modelo operativo objetivo

El sistema debe pasar de *entregar tareas a personas y creerles* a *emitir obligaciones a
posiciones, exigir prueba anclada, y hacer que cada nivel firme una muestra del de abajo*.

- **Plaza** = `puesto × sub_unidad × ámbito × turno`, con vigencia. **Es la unidad de
  asignación.** La plaza es permanente; el titular rota vía **cobertura** (plaza × persona ×
  fecha × motivo: titular / suplencia / hueco).
  > Hoy los tres anaquelistas de una sucursal reciben la MISMA tarea `anaquelista.pasillo` y
  > el sistema no sabe quién cubre qué pasillo. Eso es lo que hay que romper.
- **Ámbito** = el lugar físico o el proceso, con tipo: `pasillo | anaquel | exhibidor | caja |
  bodega | anden | rack | ruta | proceso | equipo | expediente`. Es lo que hace transversal al
  modelo: RH y Sistemas se miden igual que el pasillo 3, solo cambia el tipo de ámbito.
- **Unidad de control** = el árbol de agregación: `Empresa → Unidad → Sub-unidad → Plaza →
  Punto de control`. Las unidades ya están declaradas en `organigrama.catalogo.ts`
  (`cedis`, `sucursal`, `administrativa`, `ventas`, `comercial-marketing`, `operaciones-zona`,
  `staff-zona`, `capital-humano`, `sistemas`, `zona`, `direccion`). **Solo 14 de 89 puestos son
  de sucursal**: el 84% del organigrama es invisible en el tablero actual.
- **Norma → punto de control → aplicabilidad.** La norma dice *qué* debe cumplirse (versionada
  y autorizada); el punto de control, *cómo se prueba*; la aplicabilidad, *a qué ámbitos y con
  qué parámetros*. Una sola norma, muchos ámbitos. **Nunca listas locales copiadas.**
- **Pirámide de 5 niveles:** ejecuta (colaborador) → verifica con muestra (Encargado) →
  reverifica en visita (Gerente de Zona) → audita el sistema (Calidad) → lee dos números
  (Dirección). **Cada nivel verifica una MUESTRA del de abajo, nunca el total.**
- **Cinco causas tipificadas** de incumplimiento, cada una con dueño distinto:
  `no_asignado` (mando) · `no_ejecutado` (operación) · `sin_prueba` (formación) ·
  `no_verificado` (supervisión) · `verificado_falso` (integridad).
  Es un **campo**, no una interpretación posterior.
- **Dos números:** *cumplimiento operativo* (puntos cumplidos con evidencia válida) y
  *fidelidad del registro* (coincidencia físico ↔ sistema). El que sube a Dirección es el
  cumplimiento **topado por** la fidelidad. **Un cumplimiento sin fidelidad no se reporta.**
- **Cinco anclas de la evidencia:** lugar (etiqueta física del ámbito), momento (ventana +
  hora de captura + huella de imagen), identidad (cobertura, no nombre escrito), norma
  (versión vigente ese día), inmutabilidad (nada se borra ni se sobrescribe).
- **Prueba de fuego del modelo:** el sistema debe poder **imprimir la hoja de auditoría** de
  una plaza en una fecha pasada (norma vigente + declarado + evidencia + quién verificó y con
  qué muestra). Si no la imprime, la operación no es auditable.

## 5. Invariantes que NO se negocian

Si una implementación rompe alguna de estas, está mal aunque funcione:

1. Toda obligación pertenece a una **plaza**, nunca directamente a una persona.
2. Toda plaza-jornada tiene **un responsable o un hueco explícito**. La ausencia de datos no
   puede significar dos cosas distintas.
3. **"Hecho" exige evidencia válida.** `justificado` y `no_ejecutado` son estados propios.
   Ninguna nota, retraso ni excepción convierte un punto sin prueba en cumplido.
   > **✅ EN VIGOR desde el 13/sep/2026 (Fase 2.1, desplegada).**
   > `shared/item-completado.util.ts` exporta `estadoItem()` con los tres estados, y
   > `esItemHecho()` es exactamente `tieneEvidencia`. La justificación no se tira: se cuenta
   > aparte (`Medicion.justificados`) y la pantalla de productividad la **nombra**.
   > Antes hacía lo contrario —cualquier nota cerraba los 377 puntos sin una sola foto— y la
   > cabecera del archivo conserva el texto derogado, citado, para que nadie lo relea como
   > vigente.
4. La **norma se versiona, no se edita**, y cada emisión guarda la versión con la que se juzgó.
5. **Nada se borra ni se sobrescribe.** Corregir = evento nuevo que apunta al anterior, con
   autor y motivo.
6. **Verificar exige muestra.** Una firma sin muestra registrada no es verificación y no sube
   el indicador de nadie.
7. Todo número lleva su **coordenada completa**: unidad, sub-unidad, plaza, ámbito, turno,
   versión de norma, fecha, resultado y causa.

**Reglas de agregación (roll-up):** nunca promediar promedios (ponderar por puntos de control);
la fidelidad no se promedia hacia arriba; "no comprobado" **propaga**, no se diluye; una plaza
tiene **un solo padre** para conteo (lo demás es "servicio a"); el tablero lee un **cierre
diario materializado**, no recalcula el histórico.

**Atribución transversal:** distinguir *unidad responsable* (a quién se le cuenta) de *unidad
servida* (dónde aterriza). Un ticket vencido en Morelia Madero es rojo de **Mantenimiento** y
espera visible de la sucursal — no falla de la Encargada.

## 6. Navegación objetivo

Cuatro secciones fijas, mismo orden para todos, y lo que cambia es qué cabe según la plaza:
**Mi trabajo · Lo que verifico · Control · Definiciones**.

- **Máximo 7 entradas visibles por nivel.** Si un módulo nuevo no cabe en una sección, es una
  pestaña de una pantalla existente, no una entrada de menú. Hoy hay 19 planas.
- El menú **se calcula** de un arreglo declarativo `NAV` filtrado por la plaza de quien entró.
  Cero `*ngIf` de permisos en `sidebar.html` (hoy hay 11 condiciones distintas ahí).
- Entrada por defecto según nivel: Dirección → Tablero; Gerencia → Mi zona; Encargado → Mi
  turno de hoy; operador → Mis tareas. Hoy todos caen en `/home`.
- **Seis rutas huérfanas** (con guard y sin entrada de menú): `bloques`, `turnos`, `calendario`,
  `areas`, `flotilla`, `tareas-asignadas`. Cada una necesita lugar o retiro formal.

## 7. El plan de trabajo (9 fases, 47 pasos)

Orden por **dependencia y riesgo**, no por importancia. Un paso ≤ 3 días. Marca aquí el avance.

| Fase | Objetivo | Semanas | Depende de | Estado |
|---|---|---|---|---|
| 0 | Medir antes de tocar (detener `corte.js`, divergencia, KPIs congelados, réplicas) | 0.5 | — | 🔄 **0.1 ✅ · 0.3 ✅ · 0.4 ✅ (1 réplica, 1/sep) · falta 0.2** |
| 2 | Que los números digan la verdad (hecho ≠ justificado + primeras pruebas) | 1 | 0 | ✅ **HECHA Y DESPLEGADA 13/sep. 2.1: `estadoItem` con tres estados, `esItemHecho` = `tieneEvidencia`. 2.2: 86 pruebas. Falta 2.3 (recalcular y comparar), que sigue esperando una `DATABASE_URL` de producción** |
| 1 | Cerrar el ferrocarril: una sola base | 3 | 0 | ⬜ |
| 3 | La estructura como dato (unidad, sucursal, ámbito, puesto, plaza, cobertura) | 4 | 1 | 🔄 **3.1a ✅ (9/sep) · 3.1b ✅ (13/sep: tablas, regla, API y pantalla desplegadas — nadie ha capturado una plantilla todavía) · falta el PASE DE LISTA y el ACCESO POR PLAZA (lo que David pidió al final), 3.1c (ámbito), 3.2 (el robot emite a la plaza), 3.3 (los 119 usos de `assigned`)** |
| 4 | Navegación (4.1 se puede hacer YA, sin dependencias) | 1.5 | — / 3 | 🔄 **4.1 ✅ · 4.1b: 2a–2d ✅ (15→12 entradas) · falta el Paso 3 para llegar a 7 · 4.3 espera Fase 3 · el Dashboard ya se gatea por jefatura (3/sep) · el ÁRBOL de Tareas del Manual ya se recorta por puesto (11/sep): cada nivel arranca en su propia raíz** |
| 5 | Verificación con muestra + hallazgos + causas | 2 | 3 | ⬜ |
| 6 | Tablero por nivel + cierre diario + roll-up | 2 | 5 | ⬜ **el tablero de DIRECCIÓN ya existe y está gateado (2–3/sep); el de nivel —«Mi zona», «Mi sucursal»— no, y por eso una Encargada ve un bloque que le nombra el hueco** |
| 7 | La norma como dato (manual y organigrama fuera del código) | 3 | 3 | ⬜ |
| 8 | Anclas físicas + hoja de auditoría + fidelidad | 2.5 | 5, 7 | ⬜ |
| 9 | Higiene: polls fuera del web, partir `checklist.ts`, CORS, enterrar `backend/` | 2 | 1 | ⬜ |

**Por qué la Fase 2 se adelanta:** la migración 045 midió que la distorsión de la regla de
cumplimiento es de 1 punto. Con los números quietos, corregir la regla no mueve ningún
indicador y el paso 2.3 (recalcular y comparar) es trivial. Es la ventana más barata que va a
existir, y además le quita el defecto heredado a `productividad.util.ts` antes de que esa
pantalla se use para evaluar a alguien.

**Congelamiento — con la enmienda que la realidad pidió:** cero **módulos** nuevos hasta
terminar la Fase 3, pero una necesidad operativa real (como "Productividad y turno", que cruza
lo hecho con el horario de RH) no se rechaza: entra, y se registra aquí como deuda con la fase
que la absorbe. Lo que sí no se hace es **agregar una entrada de menú de primer nivel** — va
como pestaña de una pantalla existente. Así se llegó a las 19.

**Deuda registrada el 31/ago/2026** (contraída con el modelo ya definido, absorbida sin trabajo
extra por la fase que se indica):

| Qué se hizo | Choca con | La absorbe |
|---|---|---|
| ~~Entrada de menú 20: "Productividad y turno"~~ **SALDADA 31/ago (paso 2c)** | Congelamiento §7 | 4.1 — hoy es pestaña de Control, no entrada |
| Mapa nuevo por texto en `zonas.util.ts → POR_SUCURSAL` | Hallazgo 1 | 3.1 (semilla de unidades) |
| ~~`productividad.util.ts` hereda el defecto de `esItemHecho`~~ **SALDADA 13/sep** | Invariante §5.3 | 2.1 — usa `estadoItem` y cuenta `justificados` |
| ~~`productividad.util.ts` sin pruebas (calcula cumplimiento, puntualidad, turno, ritmo)~~ **SALDADA 13/sep** | §8.8 | 2.2 — 28 casos, con control negativo corrido |
| Foto obligatoria en los 377 puntos, incluidas 62+ declaraciones donde no hay qué fotografiar (orden de Dirección, 3/sep) | Regla 1 de `evidencia-manual.ts` | 5 — verificación por muestra; la declaración se comprueba firmando, no fotografiando |
| Migraciones 038, 039, 041, 042, 043 con nombres de personas | Hallazgo 8 | 9.4 · **no se editan** (ya aplicadas) |

**Fase 9.2 va al final a propósito:** partir `checklist.ts` antes de quitarle Firestore y antes
de que exista la plaza sería partir el problema en dos, no resolverlo.

## 8. Cómo quiero que trabajes en este repo

1. **Un paso a la vez, y termina desplegable.** Nada de ramas largas ni refactores que abarquen
   varias fases. Si el paso se estira más de 3 días de trabajo, córtalo en dos y dime.
2. **Antes de escribir código**, dime en 5 líneas: qué archivos vas a tocar, qué migración
   creas, cuál es el criterio de aceptación y cómo se revierte. Espera mi confirmación.
3. **La reversa se escribe antes que la ida.** Toda migración de datos lleva su `update`
   inverso probado (como la 037). Sin borrado físico.
4. **Criterio de aceptación verificable**: una consulta SQL con su resultado esperado, o una
   pantalla concreta. Nunca "quedó listo".
5. **No inventes datos de la organización.** Si falta un puesto, una sucursal o un ámbito, se
   deja pendiente y visible, nunca se rellena por parecido. Un puesto inventado le entrega
   obligaciones que no le tocan a una persona real.
6. **Nunca escribas a la base de Mega Talento** (`TALENTO_DATABASE_URL`), ni a producción sin
   que yo lo pida explícitamente.
7. **No toques secretos — la regla es para ti, Claude, no para David.** No leas ni copies
   `.env.local`, `backend/.env` ni `backend/service-account.json`, y no los reproduzcas en
   ningún archivo, log ni respuesta. Cuando un script necesite credenciales, escríbelo para que
   las tome de **variables de entorno en tiempo de ejecución** (como ya hace Railway con
   `FIREBASE_SERVICE_ACCOUNT` y `DATABASE_URL`), que nunca las imprima, y que David lo corra.
   Él sí puede usar sus credenciales; lo que no puede pasar es que terminen en el repo.
8. **Escribe pruebas** para toda regla que produzca un número de una persona (cumplimiento,
   retraso, turno, descanso, productividad).
9. **Sube y despliega tú, sin preguntar** (David, 31/ago/2026 — reemplaza al "recuérdame
   correr `railway up`"). Al cerrar un paso: `git push` a `main` **y** `railway up` si tocó
   `src/`, `api/`, `server.js`, `package.json`, `Dockerfile`, `angular.json` **o
   `scripts/sql/`** (una migración solo corre al arrancar: sin despliegue no se aplica). Si no
   tocó ninguno, no despliegues: dilo y explica por qué no hacía falta.
   - **Esto NO releva la regla 2.** Sigue habiendo propuesta de 5 líneas y confirmación *antes
     de escribir código*. Lo que se delegó es publicar lo ya acordado, no decidir qué se hace.
   - **Verifica que llegó, con su cifra** (regla 11): que `HEAD == origin/main`, y para la app
     un marcador dentro del código servido —presente en `dist/`, ausente en lo que se sirve
     ahora— no la fecha del `ngsw.json`. Ese método ya dio tres falsos positivos en un día.
   - **Agrupa.** El 31/ago hubo nueve despliegues y eso, por sí solo, atascó la navegación de
     los clientes: cada `railway up` cambia los hashes de los chunks y una PWA abierta con el
     índice anterior pide archivos que ya no existen. Menos despliegues es menos riesgo.
10. **Mantén este archivo al día**: cuando termines un paso, actualiza la tabla de la §7 y
    anota lo aprendido en la sección de abajo.
11. **ANTES DE VERIFICAR, DI QUÉ PREGUNTA ESTÁS CONTESTANDO.** El artefacto casi siempre pasa
    la prueba; la pregunta casi nunca. El 31/ago/2026 esto falló **cuatro veces en un día**, y
    las cuatro eran la misma falla — verificar el artefacto en lugar de la pregunta:
    - el `0` comprobaba «¿corrió el comando?» en vez de «¿midió algo?»;
    - el «89 puestos y 11 unidades» comprobaba «¿parseé?» en vez de «¿cubrí lo que uso?»;
    - dos turnos enteros comprobaban «¿cuál de las dos fichas?» en vez de «¿alguien usa alguna?»
      —los latidos de junio estaban en pantalla y nunca se compararon contra hoy—;
    - y el «62%» iba a comprobar «¿el número es correcto?» en vez de «¿la conclusión es
      correcta?».
    Corolarios operativos, que son casos de la misma regla:
    **(a)** un cero no es un resultado hasta que sepas de cuántas líneas salió; Todo script de diagnóstico
    **imprime el tamaño de sus entradas antes de concluir** y **aborta** si alguna viene vacía:
    «no pude leer» y «no hay nada» se ven idénticos. Cita siempre la cifra de la que sale el cero
    — también en tus propias verificaciones, y también en las herramientas que escribas para
    verificar (un auditor de `raise notice` dio un falso positivo por contar comas sin respetar
    paréntesis).
    **(b)** la guardia va sobre **la entrada que de verdad usas**, no sobre un proxy de ella: que
    todo `puestoId` de la base exista en el catálogo, no que el catálogo sume 89.
    **(c)** toda herramienta de verificación lleva **control positivo Y negativo**, y el positivo
    tiene que **afirmar el mecanismo, no la aparición**. Un control que dice «encuentra el caso
    conocido» lo pasa una consulta que marca TODO — y, peor, lo pasa **por otro camino**: en el
    script del selector los dos casos del 22/may caían en la cubeta C (ficha sin puesto) mientras
    la cubeta D —la que mide el `store`— **no se ejercía nunca**, porque su guardián excluía a las
    fichas sin sucursal, que son justo las del hallazgo. Un `D = 0` se habría leído como «el
    problema no existe». El control correcto afirma la cubeta: «los casos del 22/may están en E».
    Y el negativo —«un caso que sé legítimo NO debe aparecer»— prueba que discrimina.
    **Un control que pasa por el camino equivocado da confianza falsa, y eso es peor que fallar.**
    Y hay una variante que no se ve mirando el control, sino **la muestra**: el chequeo de
    escalada por pestaña (31/ago) estaba bien escrito, pero los diez perfiles de prueba veían
    las CUATRO pestañas o NINGUNA, así que recorría sin **comparar** un solo `ve` contra el de
    al lado. **Un control correcto sobre una muestra que no discrimina no discrimina.** Hizo
    falta agregar dos perfiles de **subconjunto estricto** —y no el mismo subconjunto— más una
    guardia que aborta si algún día nadie ejerce uno.
    **(d)** **si tu verificador parsea algo, primero verifica el parser — o mejor, no parsees.**
    La prueba de audiencias del menú leía `nav.config.ts` con expresiones regulares: encontró 18
    entradas de 24 y reportó como «perdidas» cinco rutas que **sí estaban** en el arreglo. Un
    parser roto no da error: da una lista más corta y una conclusión falsa, y se acaba depurando
    lo que está bien. Se resolvió **compilando** el archivo con `tsc` y usando el `menuDe()` real
    — así deja de existir una tercera versión de la lógica que pueda discrepar de las otras dos.
    **(e)** **un control anclado a datos de producción caduca cuando arreglas los datos.** Es la
    contraparte de todo lo anterior: no basta que el control mida el mecanismo correcto, también
    tiene que sobrevivir a que el mundo cambie — o se vuelve un aborto permanente que alguien
    silencia en tres semanas porque «siempre falla». El control tiene que **distinguir «la
    consulta está mal» de «el fixture cambió»** (la misma diferencia que «no pude leer» contra
    «no hay nada», un nivel más arriba) y, cuando el caso se remedie, **actualizarse en el mismo
    commit que lo remedia**. En `diagnostico-asignaciones-huerfanas.js` eso está implementado:
    comprueba su propia premisa y sale con código 3 —«resultados válidos, control caducado»—
    en vez de fingir un fallo de consulta.
    **(f)** la disciplina aplica también a la **conclusión**, no solo al dato: una media verdad en
    este archivo se vuelve doctrina en dos semanas. Si la interpretación no está cerrada, se anota
    el número y se marca la interpretación como pendiente.
12. **Cuidado con los nombres heredados de Firestore.** Los campos del documento y las columnas
    de Postgres NO coinciden: en Firestore la fecha es `date`, en Postgres es `fecha` (el mapeo
    completo está en `scripts/migrar-checklists.js`). Consultar Firestore con el nombre de la
    columna devuelve cero documentos, sin error.

## 9. Bitácora del plan

### 13/sep/2026 — PASO 3.1b: la plantilla de cada sucursal, y el tercer estado de Railway

Instrucción de David: *«falta tener una sección donde cada sucursal va a tener su propia
plantilla de cómo debería estar acomodada su zona de trabajo. Padre Hidalgo debe tener cuatro
anaquelistas, dos bodegueros, dos surtidores, una encargada, una auxiliar de encargada»*. Y
junto a eso, el objetivo de fondo: *«dejemos atrás los usuarios… ahora va a ser de acuerdo a la
plantilla del trabajo»*.

**Son tres pasos, no uno, y el orden no es negociable:** (1) la plantilla, (2) el pase de lista
—quién ocupa cada plaza hoy—, (3) el acceso por plaza. **El 3 no puede ir sin el 2**: si la
cuenta es de la plaza y nadie registra quién la cubre, el sistema pierde el nombre de quien
firmó, que es exactamente el problema del correo compartido de las migraciones 051–053. David
eligió explícitamente la opción auditable: **la identidad sale de la cobertura** (§4), no del
nombre escrito. Hoy va el paso 1, y solo su mitad de datos.

**LO QUE LA PLANTILLA ES, Y LA PLAZA NO.** `mdtask_plazas` (056) es la posición concreta y
numerada; la plantilla es la **autorización**. De la plantilla se generan las plazas, no al
revés. Separarlas es lo que permite que una plaza siga existiendo, vacía y visible, cuando
alguien renuncia: la autorización no se va con la persona.

**Y el ejemplo de David ya destapó el primer hallazgo antes de que existiera la pantalla:** él
dice **CUATRO** anaquelistas en Padre Hidalgo y el guardián de duplicados del 31/ago midió
**CINCO** fichas activas. De los **tres cajeros** no dijo nada. Una de las dos cifras está mal, y
hasta hoy no existía el lugar donde esa pregunta se pudiera siquiera hacer.

#### `sin_plantilla` NO ES `excedente`, y esa distinción protege a tres personas

Lo más importante del diseño. Los tres cajeros de Padre Hidalgo **no sobran**: nadie ha dicho
todavía cuántos debe haber. Si el código los contara como excedente, la pantalla estaría
**acusando a tres personas de sobrar por un dato que falta**. Por eso `autorizado` es
`number | null` y el null viaja hasta la pantalla — §5.2 en su forma más cara. El control
negativo va justo ahí: tratar el null como 0 rompe la aserción que nombra la distinción
(`Expected 'excedente' to be 'sin_plantilla'`), cambiando **una línea** (320 → 320).

#### PUESTOS DECLARADOS: la Fase 7 entrando por la puerta de la plantilla

David: *«quiero que pienses como un jefe reclutador en el cual, si el puesto no existe, poder
agregar uno que sea de Temporada»*. Es legítimo y conviene decir por qué: **la §8.5 prohíbe que
el desarrollo invente un puesto por parecido, no que Dirección declare uno** con autor y fecha.

Pero el hallazgo 1 de este proyecto es que la identidad se cruza por texto, y un puesto tecleado
a mano es exactamente cómo nace un duplicado. De ahí los tres candados:

1. **El id lleva prefijo `tmp-` por RESTRICCIÓN DE TABLA**, no por convención (`check (id like
   'tmp-%')`). Sin eso, alguien que teclee «anaquelista» crea un segundo puesto con el id del
   real y el cruce puesto→unidad empieza a devolver dos respuestas distintas.
2. **`hasta` es `not null`.** Una temporada sin fecha de fin es un puesto permanente con otro
   nombre, y en tres meses nadie sabe por qué existe.
3. **`revisarDeclaracion()` AVISA —no bloquea— cuando el nombre ya existe**, comparando con
   `normalizarNombre`, que es **la misma función** con la que `resolverPuesto` arma su índice de
   alias, y mirando también los `aliasCargos`: «Anaquelista» a secas es por donde pasaría el
   duplicado más probable. No bloquea porque puede haber una razón real para tener los dos.

**Y lo que un puesto declarado NO hace, dicho para que no se lea como roto:** no tiene manual,
así que **su columna de tareas sale vacía**. Es correcto —no se exige el cumplimiento de una
norma que nadie ha escrito— pero sin decirlo en pantalla parece un fallo de la app.

#### LAS PRUEBAS CAZARON DOS DEFECTOS ANTES DE QUE HUBIERA PANTALLA

**115 de 115.** Y las dos que fallaron valieron más que las 113 verdes:

1. **`idDeclarado` colisionaba de verdad.** Usaba `String(epoch).slice(-6)`: dos timestamps
   redondos daban **el mismo id**, y aun sin serlo, seis dígitos de milisegundos solo distinguen
   dentro de ~16 minutos. Dos temporadas con el mismo nombre habrían compartido id y **los
   checklists de la vieja habrían pasado a apuntar al puesto de la nueva** — historia reescrita
   en silencio (§5.5). Corregido a base 36 del epoch completo.
2. **Mi esperado de `sinManual` era 3 y son 2**, porque `cajero-sucursal` **sí** tiene manual.
   Derivado del catálogo antes de cambiarlo (19 puestos con manual de 89), no ajustado al
   resultado. §8.11 otra vez, y van varias.

**Dato para la Fase 7, medido de paso:** de los cinco puestos que David nombró,
**`auxiliar-encargado`, `surtidor-ventas` y `surtidor-sucursal` NO tienen manual**. Su plantilla
va a cuadrar y su columna de tareas va a estar vacía.

**Y una ambigüedad que NO se resolvió por parecido (§8.5):** «dos surtidores» puede ser
`surtidor-ventas` o `surtidor-sucursal`, y «bodeguero» puede ser `bodeguero-sucursal` o
`almacenista-sucursal`. David dijo que almacén y bodega son los dos, cada uno con su renglón. Lo
del surtidor **queda pendiente y visible**: lo elige quien capture la plantilla, de una lista,
que es donde esa decisión pertenece.

#### DESPLEGADO — y un TERCER estado de Railway que la guardia no conocía

    [migrate][sql] 057 · plantillas: 0 filas en 0 sucursal(es) · puestos declarados: 0 filas
    [migrate] aplicada: 057_plantillas_y_puestos_declarados.sql

**Los ceros son el resultado esperado y se declararon ANTES de desplegar**, dentro de la propia
migración. El notice sirve de control positivo **por su mecanismo**: sale de dos `count(*)`, así
que no puede imprimirse si las tablas no existen.

**Y la guardia del despliegue falló por TERCERA VEZ, con el mismo modo de fallo.** El 9/sep
negaba solo `Building`; el 11/sep apareció `Deploying`; hoy salió **`Initializing (4s)`** y el
bucle terminó en **0 esperas** porque no era ninguno de los dos. Tres veces anclando el control a
**valores concretos** en vez de a la condición que importa. La guardia correcta afirma el estado
**terminal**, no enumera los transitorios — todos ellos llevan sufijo de tiempo entre paréntesis:

    # mal:  until ! railway status | grep -qE "Building|Deploying"
    # bien: until [ "$(...status...)" = "● Online" ]

Con eso: 4 esperas, `● Online` a secas, y la app arrancando (ventana de log de **12 líneas**,
citada porque una ausencia ahí puede ser truncamiento y no ausencia).

**HALLAZGO AJENO, visto en ese mismo log y sin diagnosticar:**
`[tareas-notificar] ... la cuenta de WhatsApp está rebotando las plantillas (Business
eligibility payment issue)`. **El bot no está pudiendo avisar a la gente.** No es de este paso,
pero mientras siga así los avisos no salen.

#### LA PANTALLA (2/2), Y LA PRUEBA DE AUDIENCIAS QUE ABORTÓ CON RAZÓN

La sección entra como **pestaña de `/control`**, no como entrada de menú (congelamiento §7).
`api/plantillas.js` y `api/puestos-declarados.js` con el factory `_crud.js`, y los dos
verificados en producción: **HTTP 401**, que es el endpoint montado pidiendo token — un 404
habría sido que no se montó.

**Quién ve qué y quién puede guardar son dos preguntas**, y es la lección que ya costó tres fugas
desplegadas: **ver** es `esJefatura` con la lista de sucursales recortada por
`sucursalesPermitidas()`; **editar** es solo `esAdminGlobal`, comprobado **antes de cada
escritura** y no solo en el `*ngIf` del botón — esconder un control es cosmética.

**La pestaña ENSANCHA quién ve el cascarón `/control`**, y está dicho en el código: las otras
cuatro piden banderas, ésta pide `esJefatura`, así que una Encargada que hoy no entra va a entrar
y va a ver **exactamente una** pestaña. No se lleva ninguna de las otras cuatro, porque cada una
se gatea por su propio `ve`.

**`prueba-menu-audiencias.js` ABORTÓ con 4 diferencias, y era su trabajo:** una pestaña nueva no
es destino de ninguna fusión declarada. **El ajuste no fue aflojarla.** Ahora exige declarar la
**audiencia exacta** de cada pestaña nueva, por perfil, y comprueba las **dos** direcciones: que
no la vea nadie de más (alguien ensanchó el permiso) y que no deje de verla nadie de la lista
(alguien lo estrechó). Declarar solo el nombre —«ésta es nueva, déjala pasar»— habría vuelto la
prueba decorativa. **Control negativo: abrir la pestaña a todos dispara 11 fallos nombrando cada
perfil.**

**Tres decisiones de la pantalla que no son de estilo:**

- **El censo usa `resolverPuesto()`**, no `datos.puestoId` a secas. Contar por el campo dejaría
  fuera **en silencio** a las fichas que hoy funcionan por alias, y la sucursal parecería tener
  menos gente de la que tiene.
- **La gente sin puesto resoluble se muestra SIEMPRE, aunque sea cero.** Si se omitiera, los
  totales cuadrarían y esas personas desaparecerían de la pantalla — que es exactamente lo que
  produce el hallazgo 1.
- **Retirar un renglón marca `vigente = false`, no borra** (§5.5). En diciembre, «¿por qué esta
  sucursal pasó de cinco a cuatro?» sigue teniendo respuesta, con autor y fecha.

**Y seis tokens CSS que usé no existían** —entre ellos `--ink`, `--surface-1` y `--surface-2`,
los tres **sin respaldo**, o sea que se habrían resuelto a nada—. Los 19 quedaron validados
contra `styles.css` antes de subir. Es la lección del 4/sep: un token inventado no revienta,
iguala.

**DESPLEGADO:** `pl-sinpuesto` **0 → 4** en lo servido, **5 controles en pie**, 59 archivos ·
4.37 MB · 0 fallos, y arranca (67 802 bytes de DOM). La espera usó ya la guardia correcta —el
estado terminal, no la lista de transitorios— y tardó 5 vueltas.

**Lo que NO está hecho, dicho para que no se lea como resuelto:** **nadie ha capturado una sola
plantilla**, así que la pantalla abre vacía y su primer valor aparece cuando Dirección teclee los
números de Padre Hidalgo. **Nadie ha entrado con una cuenta real** a verla. Y los pasos 2 (pase
de lista) y 3 (acceso por plaza) **no existen**: hoy se sigue entrando con usuario y contraseña
de persona.

### 13/sep/2026 — PASO 2.2 ✅, y el día que las guardias valieron más que los datos

Día sin un solo número de producción: los tres diagnósticos que David iba a correr **no
llegaron a medir**. Y eso, que parece un día perdido, dejó tres cosas que sí valen.

#### LOS DOS CEROS ERAN «NO LEÍ», Y LOS SCRIPTS LO DIJERON SOLOS

    [regla]  checklists leídos desde 2026-08-13 → 0   → ABORTA: «con la app en producción
                                                        eso no es "no hay": es "no leí"»
    [plazas] fichas activas leídas de la base  → 0   → ABORTA: «la 050 contó 150, así que
                                                        esto es un fallo de lectura»

**Ninguno concluyó nada**, que es exactamente para lo que se escribieron esas guardias. Sin
ellas, el reporte del día habría sido «cero puntos se cierran por justificación, la Fase 2.1 es
gratis» — la conclusión más cara posible, servida con cara de dato.

**La causa es la que ningún script podía nombrar.** Un `select ... from mdtask_usuarios` que
devuelve 0 filas **sin error** significa que la tabla existe y está vacía: la `DATABASE_URL`
apuntaba a una base **con el esquema aplicado y sin datos**, no a producción. Salió de
`railway variables -s Postgres`, y el §1 ya avisaba que **el Postgres es compartido con otras
apps**: «el servicio que se llama Postgres» no tiene por qué ser el de MDTask.

**`scripts/diagnostico-conexion.js` (nuevo)** contesta esa pregunta y ninguna otra: a qué base
le estoy hablando (host, puerto, base, usuario), cuántas tablas `mdtask_` tiene y cuántas filas
hay en las cinco testigo. Cierra con un veredicto que se apoya en una cifra ya medida —la 050
contó **150 activas**— así que distingue las tres lecturas que se ven idénticas: base vacía,
base ajena y base buena. **Nunca imprime la contraseña:** parsea la URL y descarta ese campo
antes de escribir nada. Probado en su lado negativo: sin `DATABASE_URL` **aborta con código 1**,
no devuelve un cero.

#### LA PREMISA DE LA FASE 2 CADUCÓ, Y ESTABA ESCRITA AQUÍ COMO SI RIGIERA

El §7 dice «arreglar la regla ahora es gratis: son 1 punto en toda la empresa (migración 045)».
**Ese 1 se midió el 31/ago, cuando solo ~50 de 377 puntos pedían evidencia.** Desde el 3/sep los
377 la piden, así que **todo punto palomeado sin foto cae ahora en la rama de la justificación**.
La cota no vale y nadie sabe cuánto es. Es el corolario (e) —un control anclado a datos de
producción caduca cuando arreglas los datos— aplicado a **la premisa de una fase entera**, y por
eso la 2.1 queda marcada como *bloqueada por un número* en vez de *la siguiente*.

**Pero apareció un argumento mejor que el que caducó.** El bot de WhatsApp lleva meses siendo
estricto: el `itemHecho` de `api/asistente-chat.js:569` es espejo de `tieneEvidencia` y su cuerpo
**no consulta la justificación**. Así que la 2.1 **no abre una divergencia entre el tablero y el
bot: CIERRA la que ya existe en producción.** Hoy la misma persona, el mismo punto y el mismo día
se cuentan distinto según quién pregunte.

**Y el respaldo de ese argumento estaba mal medido, en mi propio script.** La línea 375 imprimía
«verificado: 0 referencias a notaEmpleado/entregaConRetraso» y el archivo tiene **10**. La
conclusión aguanta —las 10 están en el mapeo de columnas, un comentario, la **escritura** de la
justificación al enviar y reportes de envío; **ninguna dentro de las 7 líneas de `itemHecho`**—
pero era una **cadena escrita a mano, no una medición**, y encima respaldando la decisión más
importante de la fase. Corregida para decir lo comprobable y dónde mirarlo. Un «verificado» que
nadie verificó es peor que no escribir nada: se cita después como si fuera dato.

#### PASO 2.2 ✅ — `productividad.util.spec.ts`, 28 casos

La deuda registrada el 31/ago («calcula cumplimiento, puntualidad, turno y ritmo, sin una sola
prueba») queda saldada. **81 de 81 en verde** en toda la suite. Cubre lo que produce números de
una persona: la ventana de turno (varios turnos → del más temprano al más tardío; sucursal fuera
del mapa → `null`, no una ventana inventada), qué entra en la operación (Espacio TEC, archivado,
y la exclusión **sin** motivo que SIGUE contando, que es el lado seguro del error), dentro/fuera
de turno, a tiempo/tarde con límites en `HH:mm` y en `h:mm PM`, los minutos de actividad como
**promedio por día** —tres minutos en dos puntos es la firma de palomear de una sentada— y `pct`
devolviendo `null` con denominador cero, que es «no se sabe» y no «0%».

**Fija el defecto heredado a propósito**, con el nombre del caso diciendo que está mal. Control
negativo corrido, cambiando **una línea** (107 → 107 líneas, `diff` de una línea comprobado):
simular la Fase 2.1 —que la justificación deje de cerrar un punto— pone **3 pruebas en rojo** y
los mensajes nombran el defecto: `Expected 0 to be 3`. Es decir, **la 2.1 no puede pasar
inadvertida**: tiene que venir a romper estas pruebas y cambiarlas a mano.

Y una guardia de discriminación al final, por la lección del 31/ago: la misma muestra tiene que
producir **dentro Y fuera** de turno, **a tiempo Y tarde**. Sin eso, una `medir()` que devolviera
siempre lo mismo pasaría los 27 casos de arriba.

**Un comentario mío mentía y se corrigió antes de commitear:** decía que los sellos del segundo
día «se calculan sobre su propia fecha» cuando apuntaban a la del primero. La prueba pasaba igual
—el rango daba 30 por accidente—, que es justo lo que la vuelve peligrosa.

#### `git push` SIGUE BLOQUEADO, y la causa no era un permiso

`gh auth status` dice **`dev-david24`**; el remoto es **`IngeDavid2209/mega-dulces-app`**. Son
**cuentas distintas**, y por eso GitHub contesta `Repository not found` en vez de «acceso
denegado»: para esa cuenta ese repo no existe. Medido con su denominador, que es lo que lo cierra:

| medición | resultado |
|---|---|
| repos que ve `dev-david24` | **0 de 0** — el «ninguno» era «no ve nada» |
| `IngeDavid2209/mega-dulces-app` autenticado | 404 |
| el usuario `IngeDavid2209` | HTTP 200 (existe) |
| el repo sin autenticar | 404 (privado o renombrado) |

Siguen **39 commits** solo en esta laptop y en producción. La consecuencia con reloj es la del
`corte.js`: en `origin/main` esa versión **no tiene la guarda** (`CORTE_MODO` → 0 apariciones,
`batch.delete` → 1). El cron sí está muerto —el único `- cron:` del remoto es el comentario del
paso 0.1—, así que el peligro es **el botón «Run workflow»**, no el calendario. Hasta que el push
funcione, la protección es no clicarlo.

#### Y UNA CREDENCIAL QUEDÓ EXPUESTA, dicho aquí para que no se olvide

La `DATABASE_URL` **completa, con contraseña**, salió en una captura de pantalla compartida en la
conversación. Hay que **rotarla en Railway**, y antes de rotar comprobar que la `DATABASE_URL` de
MDTask sea una **referencia** (`${{Postgres.DATABASE_URL}}`) y no un literal pegado — si es
literal, rotar tumba la app hasta actualizarla. `Read-Host` evita que quede en el historial de
PowerShell, pero **hace eco en pantalla**: para credenciales, la captura es el descuido fácil.

**Lo que este día NO hizo (hasta aquí):** no movió un solo número de tablero, no tocó
`esItemHecho`, no sembró plazas y no midió divergencia. Los tres diagnósticos siguen pendientes
de una `DATABASE_URL` que apunte a producción.

#### Y ENTONCES DAVID DIJO «LA APP ESTÁ FUERA DE SERVICIO, HAZLO»

Con la app sin nadie trabajando, el argumento para esperar el número —no mover el cumplimiento
de 186 personas bajo sus pies— se cae, y la 2.1 se hizo el mismo día. **Queda anotado quién
decidió.** Lo que se dijo antes de empezar, y sigue siendo cierto: la regla se aplica **al
leer**, así que **también cambia el histórico**; los tableros no van a cuadrar contra un reporte
impreso antes de hoy. Esa comparación es el paso 2.3 y necesita el diagnóstico.

**Medido antes de tocar, y decidió el alcance:** el **ENVÍO no usa esta regla**.
`checklist.ts:3039` lo gatea con `tieneEvidencia`, que ya era la estricta. O sea que el riesgo
operativo de verdad —dejar a alguien sin poder cerrar su turno— **no existía por este camino**.
Sin esa comprobación, la 2.1 se habría hecho a ciegas sobre el flujo que usan 186 personas.

*(Nota de precisión: `MANTENIMIENTO_ACTIVO` seguía en `false` y el index respondía 200. «Fuera de
servicio» era que nadie estaba trabajando, no un corte del sistema. No hizo falta activarlo: esto
es una regla de lectura, sin migración.)*

**Qué cambió:** `estadoItem()` con tres estados excluyentes —`hecho | justificado |
no_ejecutado`— y `esItemHecho()` pasa a ser exactamente `tieneEvidencia`. La justificación **no
se tira**: `productividad.util.ts` la cuenta en `Medicion.justificados`, porque «no se pudo y lo
dijo» y «no se hizo y nadie dijo nada» tienen **dueños distintos** en el modelo de causas. Y la
pantalla **los nombra**: un porcentaje que baja sin una pista al lado se lee como un bug de la
app, no como lo que es.

**Las pruebas hicieron exactamente aquello para lo que se escribieron.** Los dos bloques «MAL Y A
PROPÓSITO» —el de `item-completado` (3/sep) y el de `productividad` (escrito esta misma mañana)—
**se pusieron en rojo al aplicar la fase** y se cambiaron a mano en el mismo commit. **86 de 86**
al final. Control negativo corrido **en las dos direcciones**, cambiando una línea (171 → 171):
con la regla vieja restaurada caen las pruebas de la fase nombrando la regresión
(`Expected 3 to be 0`, `'hecho' to equal 'justificado'`).

#### EL MARCADOR DE DESPLIEGUE IBA A DAR VERDE SIN DESPLEGAR NADA

Lo más instructivo del día, y solo se vio por medir el **antes**. El marcador elegido era
`no_ejecutado`, el estado nuevo de la regla: parece inmejorable y estaba **mal**. Medido contra
producción antes de subir, **ya valía 2**: esa cadena vive desde hace días en
`tablero-direccion.util.ts`, en el modelo de las 5 causas. `justificado` tampoco servía (6
archivos en HEAD). Y `estadoItem` da **0 en el bundle**, porque el minificador se come los
nombres de función aunque respete los literales de cadena.

**La raíz es que un cambio de lógica pura no introduce ninguna cadena propia**, así que no tiene
marcador natural. El honesto acabó siendo la clase CSS de la línea nueva —`pr-justif`,
verificada inexistente en HEAD antes de elegirla—, y esa línea **hacía falta de todos modos**
por la regla de nombrar el hueco. El marcador salió de resolver un problema real, no al revés.

    ANTES   pr-justif  dist 3 · servido 0        DESPUES  dist 3 · servido 3
            no_ejecutado         servido 2  ←  el que habría mentido
            + 3 controles en pie en los dos lados

**Desplegado y verificado:** `● Online` con el deployment ID del propio `railway up`, **58
archivos · 4.35 MB recorridos · 0 fallos**, y arranca —Chrome headless con perfil limpio devuelve
**67 802 bytes** de DOM con `app-root` y `md_rescate_arranque` presentes—. La espera negó **los
dos** estados (`Building` y `Deploying`): la guardia que falló el 9 y el 11 de septiembre por
conocer solo el primero, esta vez escrita bien desde el principio.

**Y un token que no existía, cazado antes de subir:** el CSS nuevo usaba `var(--warn-600)`, que
**no está declarado** (0 en `styles.css`). Con el color de respaldo no habría reventado nada — se
habría visto *casi* bien, que es el modo de fallo del 4/sep. El bueno es `--warn-soft-fg`, el
mismo que ya usa esa pantalla.

**Lo que sigue pendiente y no lo tapa este despliegue:** el paso **2.3** (recalcular y comparar
antes/después) no se puede hacer sin una `DATABASE_URL` de producción, así que **nadie sabe
todavía cuánto bajó el cumplimiento**. Es un número que Dirección va a pedir el primer día. Y las
otras ocho pantallas siguen llamando a `esItemHecho` sin distinguir: el que quiera separar
`justificado` de `no_ejecutado` tiene que migrar a `estadoItem`.

### 11/sep/2026 — QUIÉN VE QUÉ EN TAREAS DEL MANUAL: el permiso era binario

Captura de David: **Veronica Magaña, Gerente**, abre Tareas del Manual y lee «Organigrama 2026 ·
**25 puestos · 104 entregadas hoy**», con **Dirección General** de raíz y los **11 chips de
unidad**. Su instrucción: *«hay que trabajar con las vistas que tendrá de esta sección los
usuarios, esto lo haremos de acuerdo a su puesto en el organigrama»*.

**LA CAUSA, medida antes de tocar.** `checklist.ts:302`:

    puedeFiltrarVista = rol === 'admin' || esSupervisor(u)

No hay peldaños: **o ves solo lo tuyo, o ves la empresa entera**. Y tres cosas más que solo se
ven leyendo:

- `vistaTareas === 'todas'` **no filtra nada** (`checklist.ts:1026`): el `if` solo actúa con
  `'mis'`.
- El árbol cuelga del mismo interruptor, y **su propio comentario ya narraba este defecto una
  vez** —una Anaquelista veía el organigrama completo—. Se tapó con `puedeFiltrarVista`, que
  arregló al colaborador y **dejó a las cinco Gerencias de Zona viendo todo**. El gate estaba de
  menos abajo y de más arriba: la familia de fallas del 3/sep, otra vez.
- La escalera **ya existía y esta pantalla no la llamaba**: `alcance.util.ts` exporta `Amplitud`,
  `nivelDePersona`, `alcanceDeNivel`. El Tablero la usa; el árbol no.

#### EL CORTE NO PUEDE SER SOLO POR RAMA, Y ESO SE VE AL INTENTARLO

Lo primero que iba a hacer era podar por `reportaA`. **No funciona:** el catálogo tiene **UN
SOLO** puesto `gerencia-zona` para las cinco zonas, a propósito («la sucursal concreta sale de
los campos `sucursales` del usuario, no del catálogo»). Sus descendientes son los puestos de
sucursal de TODAS las zonas, así que un corte por rama deja a la Gerente de La Piedad viendo
Morelia y Yurécuaro — o sea, no arregla nada.

Son **dos ejes ortogonales**, que es la misma conclusión del 4/sep con otra ropa:

    VERTICAL    qué puestos le REPORTAN   → su puesto + descendientes (`reportaA`)
    HORIZONTAL  en qué lugares OPERA      → su zona / su sucursal / todos

El horizontal **recorta**; el vertical decide qué **le cuenta** y qué sale «servicio a».
La prueba lo deja como cifra: dos Gerentes del **mismo puesto** con **cero lugares en común**.

| perfil | amplitud | raíz del árbol | lugares |
|---|---|---|---|
| Dirección / acceso total | empresa | (toda) | todos |
| Gerente La Piedad | zona | **Gerencia de Zona** | 8 Esquinas · La Piedad Abastos |
| Gerente Morelia | zona | Gerencia de Zona | Morelia Abastos · Morelia Madero |
| Encargada | sucursal | **Encargado(a) de Sucursal** | Canindo |
| **sin puesto** | ninguno | (toda) | **todos — a propósito** |

#### LA REGLA DE SEGURIDAD: SIN PUESTO NO SE LE ENCOGE LA VISTA A NADIE

`esJefatura()` documenta que las fichas **sin puesto son decenas**. Gatear por puesto a secas
dejaría a decenas de supervisores con la **pantalla en blanco**, y «no veo nada» y «no tengo nada
que hacer» se ven idénticos (§5.2). El error se comete siempre hacia el lado seguro: sin puesto
—o sin sucursal— `restringido: false`, se conserva lo de hoy, y **el motivo sale en pantalla**
diciendo a quién pedírselo. Un recorte mudo se lee como un bug.

**Y no se ensanchó el acceso.** `puedeFiltrarVista` sigue decidiendo QUIÉN abre el árbol; esto
solo cambia QUÉ hay del otro lado. Dar el árbol a quien hoy no lo tiene sería una **escalada**,
que es la única dirección de verdad peligrosa al mover visibilidad.

#### LA PRUEBA CAZÓ UN BUG DE MI PROPIA REGLA, ANTES DE CONECTARLA

Interseccionaba contra `sucursalesPermitidas()` **siempre**, y esa función devuelve la lista
declarada de la ficha para cualquiera que no sea admin global. Resultado: la intersección
**deshacía la expansión de zona** y la Gerente quedaba con UNA tienda en vez de sus dos. La
distinción que faltaba: para una trabajadora, `sucursales[]` dice **dónde trabaja** —es la semilla
de la que se deduce su zona—, no su techo. El techo solo existe cuando alguien lo declaró, y eso
es `alcance === 'sucursales'` en un admin.

#### EL ARNÉS MEDÍA «¿MONTA EL ÁRBOL?», NUNCA «¿QUÉ VE DENTRO?»

`prueba-vista-por-nivel.js` aseveraba `arbol: 0|1`. **Con eso, la captura de David pasaba en
verde**: el componente montaba, que era lo único que se miraba. Es el hueco del spec del tablero
del 3/sep, un nivel más adentro. Ahora el eje es `raizArbol` —el NOMBRE del primer puesto—, que
es lo que discrimina: contar filas no sirve, dos personas pueden ver el mismo número de filas de
ramas distintas. Con dos sesiones nuevas (`gerente` y `sinPuesto`): **9 combinaciones, 7 de 7
ejes discriminan.**

#### UN NÚMERO QUE IBA A PONER A OJO Y ESTABA MAL

Aserté `chipsUnidad: 2` para la Gerente y midió **5**. Antes de cambiar el esperado —que es
ajustar la expectativa al artefacto, §8.11— lo derivé del catálogo: de `gerencia-zona` cuelgan
**40 puestos en 5 unidades** (zona · staff-zona · **ventas** · sucursal · operaciones-zona).
**5 es lo correcto y mi 2 era el error.**

Y de paso salió el dato que ordena la atribución transversal: **Ventas SÍ le reporta a la
Gerencia de Zona**. Así que los vendedores que son **«servicio a» para una Encargada** (su rama
son 14 puestos, todos `sucursal`) son **gente propia para su Gerente**. Las dos lecturas son
correctas, y distinguirlas es exactamente el trabajo del eje vertical.

#### Los tres controles negativos, una línea cada uno, `diff` comprobado

    NEG-1  el eje horizontal deja de acotar  -> 4 rotas: la Gerente vuelve a ver los 18 lugares
    NEG-2  se quita el fallback de sin-puesto -> 2 rotas, y el motivo MIENTE («Ves lo tuyo»)
    NEG-3  se quita el enraizado (en el DOM)  -> 2 rotas, y reproducen la captura literal:
           «esperaba "Gerencia de Zona", medí "Dirección General"»

#### Lo que esto NO hace, dicho para que no se lea como resuelto

- **No es un candado.** `api/checklists.js:17` declara que «el filtrado fino por rol/sucursal se
  mantiene EN CLIENTE»: el endpoint le manda toda la operación a cualquiera con token. Esto
  arregla **lo que se ve**, no lo que viaja por el cable. Cerrarlo es un paso del backend.
- **El corte horizontal usa el mapa de texto `sucursal→zona`** de `zonas.util.ts` (se le agregó
  `sucursalesDeZona()`, derivada del mismo mapa, nunca una lista aparte). Es la deuda que la
  Fase 3 ya tiene registrada.
- **El arnés sirve `/api` vacío a propósito**, así que mide el recorte **vertical** (raíz, chips,
  «servicio a») y no el horizontal con datos reales. El horizontal lo cubre
  `prueba-rama-visible.js` como prueba unitaria. Nadie ha entrado con una cuenta real.
- **Pendiente que este paso NO decidió:** si una Encargada que hoy NO pasa `puedeFiltrarVista`
  debería tener árbol. Ensanchar es escalada y no se hace sin que David lo pida.

#### DESPLEGADO — 11/sep/2026, y la guardia del despliegue falló OTRA VEZ

**58 archivos del `ngsw.json` · 4 524 875 bytes leídos · 0 fallos** (sin esa cifra un cero no
vale), con `● Online`, index en 200 y `md_rescate_arranque` presente:

| marcador | servido | qué prueba |
|---|---|---|
| `org-chip-uni` (**control**) | 1 | los archivos se leyeron de verdad |
| `org-ambito` | 1 | la línea que explica el recorte |
| `ambitoVisibleDe` | 1 | el árbol recibe el ámbito |
| `raizPuestoId` | 1 | el enraizado por puesto |

**Y la lección, que es la del 9/sep repetida con otra ropa.** La espera era
`until ! railway status | grep -q "Building"` — la corrección que escribí hace dos días. Salió
con el estado en **`● Online · Deploying (1m)`**: Railway pasa por **dos** estados, `Building` y
`Deploying`, y mi guardia solo conocía el primero. Volví a anclar el control a **un valor
concreto** en vez de a la condición que me importa («ya no está trabajando»). Esta vez no cambió
la conclusión —los marcadores ya salían en 1 y se reconfirmaron con el estado ya en `Online`—
pero el modo de fallo es idéntico. La guardia correcta niega **los dos**.

**Y una debilidad de mi propio «antes/después», dicha para que no se lea como más fuerte de lo
que fue:** medí el «antes» buscando los marcadores en el **index**, y estos tres viven en un
chunk *lazy* — o sea que ese cero era de mirar donde nunca estuvieron, no un antes válido. Es el
mismo error del 3/sep. Lo que sí sostiene la conclusión es otra cosa: las tres cadenas **no
existían en el repo** antes de este commit, así que encontrarlas servidas solo puede significar
que el código nuevo está arriba. El control positivo (`org-chip-uni`) es el que descarta que el
1 venga de un fallo de lectura.

### 9/sep/2026 — PASO 3.1a: la plaza existe como dato. «Anaquelista 1», no un nombre

Instrucción de David, literal: *«en anaquelista si hay 3, no tienen que ser con nombre, solo con
anaquelista 1, anaquelista 2, así con todos de acuerdo a cómo esté su cuadrilla de equipo de la
sucursal, zona, etc»*. Es el §4 palabra por palabra —incluido el ejemplo que ya estaba escrito
ahí— así que **no se abrió un frente nuevo: arrancó la Fase 3.**

**EL CENSO, medido antes de tocar** (`nomina-puestos.ts` × `organigrama.catalogo.ts`, compilados
con `tsc`, no parseados). Entradas: **189 filas · 89 puestos · 0 `puestoId` huérfanos**.

    personas 189 · sin puesto 5 · con puesto y sin sucursal 10 · ASIGNABLES 174
    pares puesto × lugar 97   ·  de UNA persona 62  ·  CON VARIAS 35  →  112 plazas a numerar

    CEDIS  chofer-cedis 6   ·   anaquelista 5 en CUATRO sucursales   ·   Padre Hidalgo vendedor-rd 5
    Padre Hidalgo 38 plazas (23 numeradas) · Morelia Abastos 35 (26) · Canindo 33 (19)

**Qué se construyó:** `056_plazas_y_coberturas.sql` (DDL puro) y `scripts/sembrar-plazas.js`.
**Cero archivos de `src/` y `api/`**: nadie lee las tablas todavía, la app no cambió un píxel.

**Las decisiones que David tomó y por qué importan:** el número lo **captura la Encargada**, no
el sistema —ordenar por nombre o por uid sería inventar la cuadrilla (§8.5)— así que las plazas
nacen con `numero` en **NULL**. Y la plaza va **en paralelo**, sin quitar `assigned`/`store`:
migrar los 119 usos de golpe rompería la app para 186 personas.

#### La siembra NO PUEDE ir en la migración, y eso solo se ve al intentar escribirla

El primer borrador sembraba con un `insert ... select` sobre `mdtask_usuarios`. Está mal dos veces:

1. **SQL no sabe resolver un puesto.** `resolverPuesto()` tiene DOS caminos: el `puestoId`
   explícito y el `cargo` de texto libre por `aliasCargos`. Un `where datos->>'puestoId' <> ''`
   deja fuera a las fichas que hoy funcionan por alias, **en silencio** — y sería una tercera
   versión de la regla, libre de discrepar de las otras dos (§8.11 d). El script **compila y
   llama a la función real**, e imprime cuántas resolvió por alias: son exactamente las que el
   SQL habría perdido.
2. **La `unidad` no está en la base**, vive en el `.ts` (hallazgo 5). Copiarla a un `VALUES` es
   la lista local que el §4 prohíbe.

Beneficio que no se buscaba: el despliegue quedó en **DDL puro sobre tablas que nadie lee**.

#### EL ÍNDICE ÚNICO HABRÍA DEJADO CABER UNA PLAZA DE CINCO

Lo más importante del día. Iba `unique (puesto_id, lugar, coalesce(numero, -1))`. Con `numero`
NULL en todas —**que es justo el estado en que nacen**— ese `coalesce` las colapsa al mismo `-1`:
de las cinco plazas de anaquelista de Canindo **habría cabido UNA**, o sea el defecto que el paso
entero viene a romper, reintroducido por el índice puesto para protegerlo. Y no habría reventado
de forma legible: el sembrador inserta la primera y choca con las otras cuatro.

Lo correcto es **parcial**: `unique (puesto_id, lugar, numero) where numero is not null`. Impide
dos «Anaquelista 2» —el error que sí importa— y deja convivir N plazas sin numerar.

#### UN CONTROL NEGATIVO QUE REVIENTA NO ES UN CONTROL QUE FALLA

NEG-1 (romper «buscar plaza libre») hizo que la prueba **crasheara** con un `TypeError` en la
aserción siguiente. Pasa el olfato —«el control detectó»— pero es falso: al crashear, **las
aserciones de abajo nunca corren**, así que no se puede saber si discriminan. Un `?.` lo convirtió
en fallo limpio y aparecieron **8 aserciones rotas en vez de 6**. Es el gemelo del 7/sep: allá el
control negativo cambiaba DEMASIADO, aquí **terminaba ANTES de medir**. **Un crash y un fallo son
dos resultados distintos.**

**Los dos controles, ya corregidos, cambiando UNA línea cada uno (316 → 316 líneas, `diff` de una
línea comprobado en los dos):**

    NEG-1  la plaza libre siempre es la primera  ->  8 rotas, y la que importa NOMBRA el
           defecto de hoy:  «CADA anaquelista tiene su propia plaza: esperaba 6, dio 1»
    NEG-2  la re-corrida ignora las coberturas  ->  8 rotas: «no escribe NADA: esperaba 0, dio 18»

Ese `dio 1` es el sistema actual medido en una prueba, no un argumento.

#### Y un `order by` que no es adorno

`select ... from mdtask_usuarios where activo is not false` **sin `order by`**: Postgres devuelve
las filas como quiera, y ese orden decide qué slot le toca a quién. Dos corridas, dos repartos.
Es la misma familia del `limit 1` sin `order by` de `api/login.js` que hacía entrar a una persona
a dos cuentas según el día. El slot no significa nada —**y aun así tiene que ser reproducible**
para poder auditar la siembra.

#### Lo que esto NO hace, dicho para que no se lea como resuelto

- **No mueve un solo número de tablero.** Sigue mandando `esItemHecho` (Fase 2.1). Los tableros
  suman por `store` igual que ayer.
- **No dice quién cubre el pasillo 3.** `ambito` y `turno` existen como columnas y están **vacías
  a propósito**: ese inventario físico no está en ningún dato. Es 3.1c, y necesita que alguien
  recorra las tiendas.
- **No lo ha corrido nadie contra la base.** El censo de arriba es de la **nómina de agosto** (189
  filas) contra ~150 fichas activas. El script imprime las dos columnas lado a lado y **aborta si
  se apartan más del 50%** — porque a esa distancia no es deriva de plantilla, es un fallo de
  lectura disfrazado de resultado.

#### DESPLEGADO — 9/sep/2026, y la primera verificación fue un falso positivo

    [migrate][sql] 056 · plazas: 0 filas · coberturas: 0 filas
    [migrate] aplicada: 056_plazas_y_coberturas.sql

**El `0 · 0` es el resultado esperado y se declaró ANTES de desplegar**, en la propia migración:
la siembra es un paso aparte. Y el notice sirve de control positivo por su mecanismo, no por su
aparición — sale de dos `select count(*)`, así que **no puede imprimirse si las tablas no
existen**; con una faltante el bloque revienta y la transacción hace rollback. Más `● Online`, el
index en **200 con 30 800 bytes** y `md_rescate_arranque` presente.

**LO QUE FALLÓ ANTES DE ESO, que es la lección.** La primera espera fue
`until railway logs | grep -q "escuchando en el puerto"`. Devolvió verde, y el log **no traía la
056** — que se lee como «la migración no se aplicó». Falso: `railway status` decía
`● Online · **Building (58s)**`. Estaba leyendo el log de la **instancia vieja**, que también dice
«escuchando». La guardia comprobaba «¿aparece esta línea?» en vez de «¿arrancó la instancia
NUEVA?», y como la línea existe en las dos, **no discriminaba nada**. §8.11(b) literal, y por poco
me manda a depurar una migración que estaba bien. La guardia correcta va sobre el **estado del
despliegue** (`until ! railway status | grep -q Building`), que es lo único que cambia entre las
dos instancias.

**Y el «no aparece» tampoco valía por su cuenta:** la ventana de `railway logs` viene truncada
—199 líneas la primera vez, 9 la segunda— así que una ausencia ahí puede ser truncamiento.
Se citó el tamaño de la ventana antes de concluir (§8.11 a).

**`git push` sigue rechazado** (`Repository not found`): **36 commits** viven solo en esta laptop
y en producción. Es el mismo pendiente del 2–3/sep y necesita las credenciales de David.

### 7/sep/2026 — el título de la tarjeta se leía EN VERTICAL en el celular

Captura de David: en la vista **Enviadas**, el nombre de la tarea bajaba **una letra por
renglón**. Su palabra fue «se ve horrible»; el defecto era peor que estético.

**LA CAUSA, una sola.** `.cl-head` era una fila de tres columnas —avatar · texto · pastillas— y
en `@media (max-width: 480px)` `.cl-head-actions` pasaba a `flex-direction: row` **pero conservaba
el `flex-shrink: 0` de su regla base**. Sus tres pastillas llevan `white-space: nowrap`, así que
el bloque reclamaba su ancho completo y no cedía un píxel:

    ancho útil dentro de la tarjeta          ~345 px
    avatar + gap                              -48
    COMPLETO + ENVIADO + MANUAL·3.1-3.13      -284   ← nowrap, sin encoger
    queda para el título                        0

Con **0 px** y `word-break: break-word`, cada letra es un renglón. Medido: **26 renglones** para
cuatro palabras, la meta en **6**, y la cabecera midiendo **607 px de alto** por UNA tarea.

**EL ARREGLO ES ESTRUCTURAL, NO UN PARCHE AL `flex-shrink`.** Poner `flex-shrink: 1` habría dejado
el defecto a un descuido de distancia: la siguiente pastilla con `nowrap` vuelve a estrangular el
título. En móvil `.cl-head` pasa a **rejilla de dos filas** —`[avatar][texto]` arriba, pastillas
abajo— con la columna del texto en `minmax(0, 1fr)`. Ya **no existe el camino** por el que una
pastilla le quite ancho al título.

| en un viewport de 390 px | antes | ahora |
|---|---|---|
| ancho del título | **0 px** | **270 px** |
| renglones del título | **26** | **1** |
| renglones de la meta | 6 | 2 |
| alto de la cabecera | 607 px | **115 px** |

Solo `checklist.css`. **`checklist.html` y `checklist.ts` no se abrieron** — el componente de
4 420 líneas sigue cerrado. Cero migraciones.

#### Chrome NO deja medir un celular con `--window-size`: hay que usar un iframe

Reusable, y no estaba escrito en ninguna parte. Se pidió 390, 360 y 405 de ancho en las **dos**
variantes de headless y las seis corridas devolvieron un viewport de **504 px**: Chrome topa el
ancho mínimo de ventana. Y **504 está por encima del breakpoint de 480**, así que la media query
con el defecto *no se habría aplicado nunca* — la prueba habría medido la versión de escritorio y
pasado en verde sin tocar el caso.

La salida es cargar la app en un **`<iframe>` de 390 px**: un documento en un marco evalúa sus
media queries contra el viewport **del marco**. Mismo origen, así que `contentDocument` y
`localStorage` se comparten. Está en `scripts/prueba-tarjeta-movil.js`, con guardia que aborta si
el ancho de dentro no queda en 390.

#### EL CONTROL NEGATIVO BORRÓ 1 526 LÍNEAS Y SU RESULTADO ERA CREÍBLE

Es lo más importante del día. Para medir el «antes» se restauró el bloque viejo con
`s.index('@media (max-width: 480px) {')` … y en `checklist.css` hay **TRES** bloques con ese
texto (líneas 1449, 1542 y 2929). `index()` tomó el primero y el corte se llevó **1 526 líneas**,
incluida la regla base `.cl-head { display: flex }`.

**Y no falló: dio una tabla plausible.** Título **318 px en 1 renglón**, meta en 1 renglón — que
se lee como *«el defecto no se reproduce, tu arreglo no hacía falta»*. Lo delató un solo dato al
lado: `display: block`, que no es un valor que esa regla pueda tomar por ningún camino legítimo.
Rehecho con un ancla **única** (dos líneas juntas), cambiando **una sola propiedad**, y con el
conteo de líneas comprobado antes y después: 3 815 → 3 815.

Entonces sí reprodujo el defecto exacto: **4 aserciones rotas, título 0 px, 26 renglones.**

**La regla que deja:** un control negativo no basta con que falle — hay que comprobar que falló
**por lo que se cambió**. El corolario del 31/ago decía «un control negativo que no cambia nada
prueba tanto como un cero sin denominador»; esto es el gemelo: **un control negativo que cambia
DEMASIADO también miente, y encima suena convincente.**

#### Y otros tres, todos míos

1. **Repetí el `%4d`.** El script escrito para verificar este arreglo imprimía
   `tarjeta %4d px 360`: `util.format` de Node no soporta el padding de printf. Es **el mismo
   defecto que arreglé en `diagnostico-silencio-por-unidad.js` el 4/sep**, tres días antes.
   Saberlo no impide repetirlo; lo que lo caza es leer la propia salida.
2. **La guardia estaba sobre un proxy del arreglo.** Comprobaba «¿aplicó la media query móvil?»
   mirando `display: grid` — **y `grid` ES el arreglo**. Con el CSS viejo habría abortado («no
   medí») en vez de fallar («está roto»), que son dos conclusiones opuestas. Se movió al **ancho
   del avatar** (38 px en móvil, 44 en la base), que la media query trae y este cambio no toca.
   §8.11(b), otra vez.
3. **Dos defectos que solo existían en la CAPTURA, no en las cifras.** El ancho y los renglones
   ya estaban bien y aun así se veía mal: un **`·` colgando** al final del primer renglón de la
   meta (la fecha bajaba y el separador quedaba viudo — se esconden en móvil y separa el hueco),
   y el **anillo en 0 %** con la pastilla COMPLETO. Medir no sustituye mirar.

#### HALLAZGO NUEVO, sin arreglar a propósito: «Enviadas» muestra 0 % siempre

`cargarEnviadas()` (`checklist.ts:1278`) empuja las filas crudas y **nunca calcula
`calcCompletados` ni `calcProgreso`** — el cargador de «pendientes» sí lo hace (`c.calcCompletados
= tareasMarcadas`). Así que **toda tarjeta del historial muestra 0 %**, sin importar lo que se
cumplió. Es la vista de la captura de David.

**No se arregla hoy, y el motivo importa:** arreglarlo es agregar un consumidor nuevo de
`esItemHecho`, que es exactamente la función que la otra sesión está cambiando en la Fase 2.1.
Tocarla en paralelo pondría dos reglas de cumplimiento en vuelo a la vez. **Va después de la
2.1**, y cuando vaya lleva prueba: es un número de una persona (§8.8).

**Pendiente menor, también de la captura:** la fecha decía **`2026-09-31`** y septiembre tiene 30
días. Dato inválido llegando desde la emisión, no estilo. Sin diagnosticar.


### 4/sep/2026 — EL EJE TRANSVERSAL, en la pantalla del organigrama (NO en los números)

Salió de una captura de David: la misma colaboradora colgando de **COMPRAS**, **MANTENIMIENTO**
y **SISTEMAS**, y su lectura fue «no los estás acomodando conforme a su puesto». El árbol estaba
bien. Lo que estaba mal es que **los cuatro tipos de `store` se pintaban idénticos**, así que un
área administrativa y un canal de órdenes se leían como plazas.

**LO MEDIDO, que es lo que decidió el diseño.** Cruzando las 189 filas de `nomina-puestos.ts`
(184 con puesto, **0 fuera del organigrama**) contra la `unidad` de cada puesto:

    store (sucursal de la app)   gente  unidades de control de su gente
    Padre Hidalgo                  38   ventas:15  sucursal:13  operaciones-zona:6
                                        staff-zona:2  comercial-marketing:2
    Morelia Abastos                35   sucursal:18 operaciones-zona:9  staff-zona:3 ...
    CEDIS                          16   cedis:14  operaciones-zona:1  staff-zona:1
    FINANZAS                        8   administrativa:7  staff-zona:1
    COMPRAS                         3   comercial-marketing:3     ← NO administrativa
    MANTENIMIENTO                   1   administrativa:1

**8 de 16 stores mezclan unidades**, y al revés la unidad `sucursal` aparece en 8 stores,
`staff-zona` en 7, `ventas` en 5. **Ninguno determina al otro: son dos ejes ortogonales, lugar ×
departamento.** Por eso esto NO es un mapa `store → departamento` — ese mapa no existe.

**Y escribirlo a mano habría fallado en 2 de 9 áreas.** Iba a poner `COMPRAS → administrativa` y
su gente es de **Comercial y Marketing**; `MANTENIMIENTO` es `administrativa` aunque el esquema
lo declare valor especial. Es la §8.5 en un caso concreto: **el departamento no se deduce del
nombre del área.** La clasificación se **deriva** de `zonas.util.ts`, que ya es la única fuente
(§4: nunca listas locales copiadas), y lo que no está en ese mapa sale visible como pendiente.

**El número que hay que decirle a Dirección:** en Padre Hidalgo, **15 de 38 personas son de
VENTAS**. Hoy sus puntos se suman al número de «Padre Hidalgo», o sea **al de la Encargada**.
Rojo de Ventas, espera visible de la sucursal.

**Qué cambia en pantalla** (`unidad-servida.util.ts` nuevo + `vista-organigrama.*`): cada lugar
dice qué es (sucursal con su zona · corporativo · canal · sin zona); sale **«servicio a»** cuando
la unidad responsable no es la del lugar; y sale **«+N lugares»** cuando la misma persona recibe
su manual en varios, porque el robot lo entrega **una vez por cada entrada de `sucursales[]`**
(`robot-manual.service.ts:175`, con la sucursal metida en el id de idempotencia) y **eso le
multiplica el denominador**. Antes era un nombre repetido sin ninguna pista.

**LO QUE NO SE AFIRMA, A PROPÓSITO:** si un puesto de sucursal aparece en un store corporativo,
no se dice nada. Haría falta saber el «hogar natural» de cada unidad, y la medición dice que ese
dato **no existe todavía**. Marcar de más ahí sería inventar la mitad del modelo.

**Ningún paso del plan se movió.** Esto es el eje en **una pantalla**, no en los números: los
tableros siguen sumando por `store`, así que los puntos de esos 15 vendedores le siguen contando
a la Encargada. El arreglo de fondo es la Fase 3 (la unidad como dato), y su candado es que el
cruce puesto→unidad **no se puede escribir en SQL** — la unidad vive en un `.ts`. Mismo muro que
frenó el split del silencio.

**Y la coordenada ya está a medias, que era lo que no se sabía.** El emisor sella
`_manualDocumento`, `_manualCodigo`, `_manualVersion`, `_tareaManualId`, `_puestoId` y `_momento`
en cada checklist: **la norma y su versión ya viajan en la emisión** (mitad del invariante 4).
Faltan `unidad`, `ámbito`, `turno` y `causa`. Cuando se selle la unidad, hay que **sellarla y no
calcularla al leer**: el día que una reorganización mueva un puesto de unidad, calcular al leer
**reescribiría la historia**.

**Doble conteo ya identificado para el roll-up:** el manual del **Checador** lo comparten
`checador` (operaciones-zona) y `checador-cedis` (cedis) — **3 tareas y 28 puntos que caen en dos
unidades**. Sumando por puesto dan 50 tareas y 394 puntos contra las 47 y 366 del catálogo. Es el
caso de prueba de «una plaza, un solo padre».

**Y lo que el eje va a destapar el primer día:** de las 11 unidades, **5 tienen CERO manual** —
Dirección (1 puesto), Staff de Zona (5), **Ventas (11)**, Capital Humano (5), Sistemas (3)—, y
**70 de 89 puestos (79%) no tienen manual**. Los 15 vendedores de Padre Hidalgo son de esa
`ventas`: se les cuenta en la sucursal y **no tienen una sola tarea propia**. El eje no los
arregla, los **nombra**. Eso es Fase 7 (autoría de norma), no código.

#### Las pruebas, y sus dos controles negativos corridos

`scripts/prueba-unidad-servida.js` (nueva, sin credenciales ni base): **15/15** lugares con gente
real se clasifican, y **la muestra discrimina** (sucursal 3 / no-sucursal 6 · cruzada 3 / no
cruzada 4). Aflojar la regla a `return true` rompe las **4 aserciones negativas** (código 2);
apagarla a `false` dispara la **guardia de discriminación** (código 1). «No pude medir» y «falló»
quedan separados, que es lo que este repo pide.

En el DOM, 5.º escenario de `prueba-arbol-organigrama.js`:
`sucursal 2 · corporativo 1 · canal 1 · sin-zona 1 · servicio-a 1 · +lugares 4`. Control negativo:
marcar toda sucursal sube `servicio-a` a **2** y la aserción lo caza **nombrando al anaquelista**.

#### Lo que enseñó, que vale más que la pantalla

**El escenario nuevo nació dando SEIS CEROS perfectos**, que se leen como «las pastillas no se
pintan». No era eso: `sembrar()` abre los **ancestros** del puesto con trabajo y deja el puesto
con trabajo **visible pero CERRADO**, así que sin clic ni búsqueda **no existe ninguna fila de
lugar que pintar**. El cero era del escenario, no de la función. Se arregló tecleando en el
buscador, que además hace caer las dos ramas —la de sucursal y la administrativa— sin las cuales
la regla de atribución no tendría un sí y un no que comparar.

**Un token que no existe no revienta: iguala.** El primer CSS usó `--warning` y `--danger`, que
**no existen** en el sistema de diseño (0 declaraciones en `styles.css`). Con el `var(x, y)` de
respaldo no habría fallado nada visible: el **canal** y el **desconocido** —dos cosas distintas—
se habrían pintado **igual**, sin un solo error en consola. Los buenos son `--warn-*` y `--bad-*`.
Y el verificador de tokens **también tuvo que verificarse**: un «sin líneas faltantes» sale
idéntico si la extracción devuelve cero tokens. Se citó la cifra (**17 extraídos**) y se le metió
un token inventado que sí se reporta.

**Y el `\n` dentro de `\Q...\E` de Perl es una `n` literal**, así que un reemplazo de dos líneas
fue un **no-op** que no cambió nada y podría haberse leído como «el control no detecta». Lo cazó
comparar el archivo antes y después. Es la misma regla del 31/ago: **un control negativo que no
cambia nada prueba tanto como un cero sin denominador.**

**El fallo de proceso, que es mío:** el commit `7a5bd2e` se llevó también cambios de la otra
sesión en `scripts/prueba-arbol-organigrama.js`. Revisé el `.ts` y el `.html` buscando hunks
ajenos y **no revisé los otros dos archivos**. El CSS sí se salvó —se commiteó solo mi bloque
construyendo el blob desde HEAD con `git update-index`, dejando su trabajo intacto en el árbol—,
pero la revisión tiene que ser de **todos** los archivos del commit, no de los que uno sospecha.

**Trabajar dos sesiones en el mismo árbol tiene una regla dura que salió de aquí:** `railway up`
sube el **directorio de trabajo**, no lo commiteado. Desplegar con otra sesión a medias publica su
trabajo sin terminar a 186 personas. Se resolvió preguntándole por `SendMessage` y esperando a que
commiteara; **no se despliega con el árbol sucio de otro.**

#### DESPLEGADO — 4/sep/2026, verificado con control positivo

58 archivos del `ngsw.json`, **4 520 497 bytes leídos, 0 fallos** (sin esa cifra un cero no vale):

| marcador | antes | ahora |
|---|---|---|
| `org-chip-uni` (**control**) | 1 | **1** |
| `org-destino` | 0 | **1** |
| `org-destino-canal` | 0 | **1** |
| `org-cruzada` | 0 | **1** |
| `org-multi` | 0 | **1** |
| `servicio a` | 0 | **1** |

Y arranca: Chrome headless con perfil limpio devuelve **67 802 bytes** de DOM, 1 `app-root`, con
`md_rescate_arranque` presente.

**El `ngsw.json` pesó 7184 bytes ANTES y 7184 DESPUÉS.** Lo que detectó el despliegue fue el
**md5 de su contenido**, a los 60 s. Es la tercera vez en dos días que ese proxy habría dicho «no
llegó» con el código ya servido: **el tamaño y la fecha del `ngsw.json` no son un marcador.**

**Lo que esto NO prueba:** que se vea bien, y que el ×N de una ficha esté mal. Lo primero necesita
ojos —nadie ha entrado con una cuenta real—; lo segundo necesita las consultas a la base que solo
David puede correr.

### 4/sep/2026 — «todo en una sola vista»: el árbol estaba en un recuadro

Instrucción de David: *«hazlo más grande, lo quiero todo en una sola vista»*. No era gusto: el
árbol vivía **encajonado**, y los dos topes eran del componente, no de la app.

**Medido antes de tocar, en un viewport de 1440×900:** de las 16 filas del árbol sembrado
**cabían 5**. La lista medía **820 px** de los 1045 disponibles y `.org-menu` tenía
`max-height: 640px` con barra propia — **scroll dentro del scroll**. La lista empezaba en
**y=532**, y de esos 532, **236 eran cromo del propio componente**:

    org-barra=97 (antes: org-head 71 + org-filtros 125 + org-pista 17 = 213)
    org-cab=23 · section-header=94 · cl-toolbar=42 · header=64

Los 125 px de los filtros eran los **11 chips envolviendo en dos líneas**: 69 px tirados, que son
dos filas del árbol. Ahora es **una barra pegajosa** de dos renglones —identidad + buscador +
acciones, y chips que se deslizan— con el encabezado de columnas **dentro** de ella, para que se
pegue junto sin un `top` mágico que se despegue el día que alguien cambie el relleno. La pista de
uso se fue al `title` y al placeholder: era un renglón permanente para un texto que se lee una vez.

**Resultado, mismo viewport: 5 → 16 filas · 820 → 1045 px · una sola barra de scroll.**
El árbol pasó de quedarse con el 41% de la pantalla al **58%**.

**El tope global de `.content` (1720 px, `styles.css`) NO se tocó:** es una decisión de toda la app
y tiene su razón escrita. Y los **44 px de fila se conservan en móvil** —el mínimo táctil de iOS,
donde pasa el 100% de la operación—; los 32 px son solo de `min-width: 861px`, que es donde se
leen los tableros.

#### Cuatro falsos de mi propio instrumental, y ninguno se cayó solo

1. **Un `+` que faltaba no dio error.** En la cadena inyectada al navegador, la línea terminaba en
   `,'` sin operador: la **inserción automática de punto y coma** partió la expresión en dos
   sentencias **válidas**, así que `iny` se quedó sin su cierre y sin `</script>`. `node --check`
   pasa. El navegador recibió un script truncado y no fijó el título — que se lee como «la app no
   pintó». Un carácter que no rompe: **acorta la cadena en silencio.**
2. **La etiqueta decía «1440x900» y el viewport real era 1422×748.** En `--headless=new` Chrome
   emula una ventana **con cromo**, así que el alto pedido no es el que se mide. Todas las cifras
   de «caben N» venían contra una pantalla más corta que la declarada — **un número sin su
   denominador**. Ahora se pide alto + cromo y hay una **guardia que aborta** si el viewport real
   no cae donde dice la etiqueta.
3. **El testigo se rompió al compactar la barra**, porque su regex estaba anclada al texto largo
   del subtítulo. Abortar fue lo correcto —no concluyó con el testigo ciego— pero es el
   corolario (e): un control anclado a algo que se mueve caduca. Ahora acepta las dos redacciones.
4. **Y una aserción que no podía fallar.** `scrollInterno === 0` parecía comprobar que el recuadro
   se fue; con un fixture chico la lista **nunca llega a los 640 px**, así que valía 0 **con el
   recuadro puesto**. El control negativo lo destapó: al restaurar los topes solo falló 1 de 3.
   Se cambió por leer `max-height` del **estilo calculado**, que discrimina siempre; NEG-3 ahora
   rompe 2 de 2.

**CORRECCIÓN, el mismo día (§8.11 f).** Lo de arriba dice que las filas quedaron en 32 px y que
caben 16: **ya no es cierto, y dejarlo escrito lo volvería doctrina en dos semanas.** David
repitió *«haz el diseño del organigrama más grande»*, y ahí se ve que había entendido a medias:
**el acierto era quitar el recuadro y el tope de 820 px, no apretar el contenido.** Encoger la
fila a 32 px y el título a 14 px es lo contrario de lo que pidió. Los dos bloques
`@media (min-width: 861px)` que encogían se quitaron y la escala subió un peldaño completo:

    fila de puesto   32 -> 52px      nombre de puesto  15 -> 17px
    fila hija        28 -> 46px      raiz              16 -> 19px
    guia de nivel    18 -> 24px      colaborador       14 -> 16px
    buscador         32 -> 40px      tarea             13 -> 15px
    titulo           14 -> 18px      avance            12 -> 14px

Coste medido y aceptado: **caben 9 filas de 17**, no 16. Lo que **no** se devolvió es el
encajonamiento — sigue sin `max-height`, sin tope de ancho y con una sola barra de scroll. Y el
mínimo táctil de iOS deja de necesitar regla aparte: 52 px lo supera en todas las pantallas.

**Y el arreglo destapó un defecto de 4 px que a ojo es «casi alineado».** Al quitar el bloque de
densidad se fue con él el `padding` horizontal de `.org-menu`, que volvió a 14 px mientras
`.org-barra` quedaba en 18. El encabezado de columnas vive en la barra y las filas en la lista,
así que sus ejes derechos se separaron —**1340 contra 1344, con anchuras idénticas (262/262)**— y
los rótulos dejaron de caer sobre su columna. Es el defecto de los 94 px con otra ropa. Hay
aserción permanente que compara los dos ejes en el DOM, y **se vio en rojo antes de arreglarlo**:
no es de las que nunca han fallado.

**Lo que NO se prometió:** que quepan *todas* las filas siempre. En producción un árbol sembrado
son decenas y ninguna altura las mete en una pantalla — asertar eso habría fijado el diseño a los
5 checklists de la prueba. Por eso la aserción es **estable y de diseño**: al árbol le toca ≥55%
de la pantalla. Lo que sí desapareció es la **segunda barra de scroll**.


### 4/sep/2026 — el árbol del organigrama: de 1 fila y 6 clics, a 16 y 0

Cambio de **diseño de navegación**, no de reglas: `vista-organigrama.ts/.html/.css` y nada
más. Cero migraciones, cero escrituras, `checklist.ts` sin abrir (`git diff` vacío).

**El defecto, medido antes de tocar.** El organigrama tiene UNA raíz y el árbol arrancaba con
todo cerrado, así que la pantalla abría con **una sola fila**: «Dirección General». Y 53 de los
89 puestos (el **60%**) viven en el nivel 3: tres clics para que el puesto apareciera y tres más
—puesto, sucursal, colaborador— para ver su primera tarea. **Seis**, y siete en el nivel 4.

Arrancar cerrado seguía siendo correcto (abrirlo entero son cientos de filas); lo que estaba mal
era que **cavar a mano fuera el único camino**. Cinco arreglos: buscador que se poda y se abre
solo hasta el resultado (casa contra puesto, unidad, **sucursal y nombre de persona**), siembra
por trabajo del día con tope, apertura de **pasillos** (cadena de un solo hijo), botón «rama» más
alt+clic, y **guías de nivel** en vez de solo 18px de sangría. Más chips por unidad de control,
con las etiquetas leídas de `ETIQUETAS_UNIDAD` —nunca una lista local— y caída a la etiqueta
oficial si el catálogo gana una unidad, para que ninguna se pierda en silencio.

**Aceptación medida en el DOM** (`scripts/prueba-arbol-organigrama.js`, cuatro escenarios):

    escenario                   puestos  sucurs  personas  entregas  guías  vacío
    con dato, sin tocar nada      16        1        0         0       37     0
    sin ningún dato                5        0        0         0        4     0
    busco "Yesenia"                4        3        3         2       44     0
    busco "zzzqqq" (no existe)     0        0        0         0        0     1

#### Lo que de verdad enseñó: el testigo salvó la conclusión, dos veces

**Las dos primeras corridas midieron NADA y se veían plausibles.** Daban «5 filas con dato» y
«5 filas sin dato» — que se lee como **«la siembra está rota»**. Lo roto era el dato de prueba, y
me habría ido a depurar código que funcionaba. Lo cazó el **testigo independiente**: el
componente publica en su subtítulo cuántas entregas contó, y decía **0 con 5 servidos**. Ese
número es lo único que separa «la siembra no abre nada» de «no hubo qué abrir».

Y las causas fueron **dos, encadenadas**, ninguna visible leyendo el código:
1. **Faltaba `_origenManual: true`.** `checklistsFiltrados` recorta con
   `esTareaDeManual(c) === modoManual` (`checklist.ts:1016`), así que el apartado del manual
   descartaba mis filas. Llegaban y se tiraban.
2. **`ApiService.token()` exige un usuario de Firebase Auth** y lanza «Sin sesión activa»: en
   headless el `fetch` a `/api` **nunca sale**. Por eso `prueba-vista-por-nivel.js` dice que solo
   mide el gate y no el dato. Se resolvió reusando el parche de `prueba-dom-evidencia.js` —copia
   del `dist/`, ancla exigida **una sola vez**, `dist/` real comprobado intacto— más una guardia
   nueva: **si un escenario nunca pidió `/api/*`, aborta.**

#### Los dos controles negativos, corridos — y el segundo es el que vale

- **NEG-1, siembra apagada:** rompe 5 aserciones y la que importa nombra la causa: «la siembra no
  destapa nada: 1 fila con dato contra 1 sin dato. El testigo confirma que el dato SÍ llegó».
  De paso **deja medido el defecto original en el DOM**: con la siembra fuera, «con dato» da
  **1 fila**. La premisa del rediseño dejó de ser un argumento y pasó a ser una cifra.
- **NEG-2, la búsqueda deja de abrir sucursal y persona:** sale con código 2 y rompe exactamente
  las 2 aserciones del mecanismo. **Y aquí está la lección:** la poda seguía funcionando —4
  puestos, 3 sucursales—, así que un control de «aparecen menos filas» habría dado **verde**.
  Solo lo cazó la aserción que afirma la cubeta: que la **fila de entrega**, tres niveles más
  abajo, quede visible sola. Es §8.11(c) literal, por una puerta nueva: **el control tiene que
  afirmar el mecanismo, no la apariencia del resultado.**

**Y mi propio verificador de CSS muerto dio un falso positivo** al medir el punto de partida:
reportó 45 clases sin usar y son 44 — `.org-nivel-0` se aplica por interpolación
(`org-nivel-{{ f.prof }}`), así que el grep literal no la ve. §8.11(d) otra vez: si tu
verificador parsea, verifica el parser.

**Pendiente declarado, a propósito fuera de este paso:** las **44 clases `.org-` y 4 métodos
muertos** (`sinEntregaDe`, `textoFrecuencia`, `textoMomento`, `trackTarea`) que quedaron del panel
de dos columnas retirado. Van en un commit aparte: borrar la mitad del CSS de una pantalla viva
merece su propia verificación, y mezclarlo haría imposible saber cuál de los dos cambios rompió
qué.

**Lo que esto NO prueba, dicho para que no se lea como resuelto:** que se **vea** bien. Prueba que
el árbol se abre solo, que el filtro discrimina y que el vacío se nombra. La alineación de las
guías, el comportamiento de los 11 chips en un celular real y el `alt+clic` con dedos siguen
necesitando ojos — y **nadie ha entrado con una cuenta real**.


### 3/sep/2026 — TODOS los puntos piden foto: una orden de Dirección, y lo que destapó

**La orden, literal:** «el jefe quiere que todas las tareas tengan evidencia, entonces a todas
actívale la evidencia fotográfica, que solo se pueda tomar la foto al instante» y «que sea más de
una foto». Se ofreció dejar fuera las declaraciones —315 en vez de 377— y Dirección **eligió los
377**. Queda anotado quién decidió, no para volver a discutirlo.

**Lo medido antes de tocar**, de 48 tareas y 18 manuales:

| | puntos |
|---|---|
| **total** | **377** |
| pedían foto obligatoria | 50 |
| pedían varias fotos | 1 |
| piden documento (PDF que ya existe) | 45 |
| no pedían nada | 281 |
| — de esos, **declaraciones** en 1ª persona | **62 (piso, no total)** |
| — estados físicos, fotografiables | 219 |

**Contradice la regla 1 de `evidencia-manual.ts`, y eso se dijo antes, no después.** El archivo
decía: *«Las declaraciones no piden nada… exigirles evidencia obliga a inventarla, y una
evidencia inventada es peor que ninguna.»* La regla 2 —la evidencia se raciona— quedó
**derogada** en la cabecera, con su texto anterior citado. Una regla vieja que sigue escrita como
si rigiera es doctrina falsa en dos semanas.

**El 62 es un piso.** El detector busca la vocal acentuada al final del verbo, así que «No hice
préstamos de caja» no la caza. Y el **primer** detector mintió: `\b\w+í\b` casaba «día» de
«Tareas del día», porque `\w` no incluye acentos en JS y el borde `\b` cae **dentro** de la
palabra. Corregido con siete controles, positivos y negativos, incluido el falso positivo que
tenía.

#### Dos trampas que habrían roto la operación, encontradas antes de subir

1. **Las dos banderas juntas bloquean TODO.** `tieneEvidencia` exige `photos[]` cuando hay
   `requiresVariasFotos` **y además** `item.photo` cuando hay `requiresPhoto`; pero la plantilla
   **esconde** el bloque de foto única si `variasFotos` está encendida. Con las dos, `item.photo`
   no se puede llenar por ningún camino de la interfaz y **ningún punto se completaría jamás**.
   Hoy se salva por el **orden de los `if`**, que es un accidente, no una decisión — y por eso
   hay una prueba que lo deja escrito y la 055 comprueba que no quede ningún punto con las dos.
2. **`onMultiplePhotoSelected` se comía los archivos.** Tomaba `files[0]` y descartaba el resto.
   Sin `multiple` no se notaba; al ponerlo, la persona habría elegido tres archivos, habría visto
   uno, **sin ningún error**, y el punto quedaría «con evidencia» con un tercio de lo entregado.

**Y los 45 puntos de documento conservan su selector libre.** Antes caían en la rama de foto
única; ahora todos caen en la galería, así que sin la excepción el input sería `image/*` con
cámara forzada y esas personas **no podrían adjuntar el PDF que se les pide**.

#### El `@defer` que iba a meter no hacía falta, y eso lo dijo la medición

Predije el cuadruplicado de la 046 y **me equivoqué**: ese ×4 lo causaba el bloque de **foto
única** (~200 líneas por punto), no la galería, cuyo estado vacío es compacto. Medido con un
checklist de 23 puntos, **mismo build, cambiando solo el dato** —la plantilla pinta según las
banderas del item, así que las cuatro condiciones no necesitan cuatro compilaciones—:

    condición  nodos  bloques  cámara  sin-cámara  multiple  miniat.  lazy   HTML
    hoy         294      3       3         0          3        0       0    32 KB
    todos       374     23      23         0         23        0       0    43 KB
    cargado     926     23      23         0         23       69      69   134 KB
    docs        374     23       0        23         23        0       0    43 KB

**×1.27 en vacío, no ×4.** Así que `checklist.html` no se tocó más de lo necesario —es el
componente de 4 420 líneas del hallazgo 4—. Lo que sí crece son las miniaturas al final del turno
(69), y por eso llevan `loading="lazy"`. La fila `docs` es la aserción de seguridad: **cero**
puntos de documento con cámara forzada.

`scripts/prueba-dom-evidencia.js` deja las cuatro corriendo solas. Es autocontenido: copia el
`dist/`, parchea la autenticación **en la copia** —y aborta si el `dist/` real quedó tocado, o si
el ancla del parche no aparece exactamente una vez—, sirve, pinta y cuenta.

#### `enviado` es columna, y por poco me lleva la historia por delante

El primer borrador de la 055 filtraba con `coalesce((c.datos->>'enviado')::boolean,false) is not
true`. Pero **`enviado` es una columna tipada** (`009_checklists.sql:15`), no un campo de `datos`:
eso da `NULL` en todas las filas, así que el filtro **pasaba todo, enviados incluidos**, sin un
solo error de SQL. Un punto cerrado ayer con un palomeo legítimo —cuando no pedía foto— habría
pasado a «sin evidencia» al encenderle la bandera, y el cumplimiento histórico de 186 personas se
habría hundido sin que nadie hubiera dejado de trabajar.

Es el §12 **un nivel peor**: ahí el nombre equivocado devuelve cero; aquí devuelve **todo**.
`fecha` es `text 'YYYY-MM-DD'` y también estaba mal comparada. La 055 excluye enviados,
eliminados, archivados y fechas pasadas: la norma nueva rige desde hoy (invariante 4).

**Dato de alivio que conviene saber:** una migración que revienta **no tumba el servidor**
(`server.js:184` la lanza sin `await` y solo registra el error), y va en transacción, así que no
puede quedar a medias.

#### Y LO MÁS IMPORTANTE: esto vale en la pantalla, NO todavía en los números

    esItemHecho(item, checklist):
      if (tieneEvidencia(item)) return true;
      return tieneJustificacionChecklist(checklist);   // ← cualquier nota, o retraso

`tieneEvidencia` sí es estricta: sin foto el punto no se cierra en pantalla. Pero `esItemHecho`
—que es lo que leen Dashboard, Auditoría, Checkstore, Estadísticas, Ranking y Productividad—
cuenta el punto como hecho **si el checklist trae una nota o se entregó con retraso**. O sea:
alguien escribe un carácter y **los 377 puntos cuentan como cumplidos con cero fotos**, en
silencio, y los números salen preciosos.

**Eso convierte la Fase 2.1 en el paso siguiente, no en uno más de la lista.** Sin ella, la orden
de Dirección es una molestia para quien trabaja y no cambia un solo indicador. Hay una prueba
escrita a propósito con el defecto de hoy fijado, para que la 2.1 **tenga que venir a romperla**
en vez de mover los números de 186 personas sin que nadie lo note.

**Alcance, dicho para que no se lea de más:** esto cubre los **377 puntos del Manual
Corporativo**, que es lo que emite el robot. Las tareas creadas a mano —áreas, rutinas, tarea del
día, actividades de equipo, Espacio TEC— siguen con su propio interruptor de «requiere foto», que
marca quien crea la tarea. Si Dirección también quiere ésas, es cambiar el valor por omisión de
esos formularios y se dice.

**Y el límite de «solo al instante», sin adornos:** `capture="environment"` abre la cámara trasera
directo en el celular —donde pasa el 100% de la operación— pero es una **indicación al navegador,
no un candado**: en un escritorio se ignora. Lo que sí queda duro es que cada foto se guarda con
su **hora de captura**, visible sobre la miniatura. Un candado de verdad sería una cámara dentro
de la app (`getUserMedia` con botón de disparo), y eso es un paso aparte que no se metió aquí de
contrabando.


### 3/sep/2026 — QUIÉN VE QUÉ: el gate estaba de más en tres bloques y de menos en uno

Es la corrección más importante de los dos días, y **no se habría visto leyendo código ni
corriendo `ng test`.** Solo existe en el DOM.

**Lo medido.** Con una sesión sintética de Encargada, el Tablero de Dirección salía con
`unidades: 10` —las diez unidades de control de la empresa entera— y la cabecera rotulada
**«Dirección · Canindo»**. `ng test` en verde, el build en verde, la prueba de audiencias del
menú en verde. `verEmpresa` estaba puesto en **tres de los cuatro** bloques de nivel empresa;
al cuarto le faltaba, y era el que más enseña.

**Y al revés en los otros tres, que es la mitad que no había visto.** Las cifras de los bloques
2, 3 y 6 salen de `agregado()`, que `home.ts` carga con el filtro de alcance **ya aplicado**:
son los números *de quien mira*. Gatearlos a Dirección le escondía a una Encargada su propio
dato. La misma pantalla tenía el gate **de más en tres bloques y de menos en uno** — y las dos
mitades se veían igual de bien en una captura.

Lo de empresa se esconde ahora **por cifra** (`esEmpresa`), no por bloque: de las seis cifras
del bloque 2, cinco son suyas y solo una —el 62 % del silencio— es de la empresa. Antes se
escondía por `confianza === 'medido'`, que es un **proxy**: el día que se agregue otra cifra
medida y propia, ese proxy la esconde sin ruido. Es §8.11(b) otra vez — la guardia va sobre la
entrada que de verdad se usa.

**Y para quien no ve el nivel empresa, el hueco se NOMBRA.** Un bloque menos y ninguna pista se
lee como «el tablero está roto». Es la regla del guion aplicada al bloque completo.

#### El spec llevaba un día midiendo otra cosa

`alcance-tablero.spec.ts` probaba una función `verTablero` **copiada dentro del propio spec**,
con la regla `esAdminGlobal`. La app pasó a `hayTableroPara = esJefatura` (instrucción de David:
«este solo lo deben de ver las jefaturas») y la prueba **siguió en verde midiendo su copia**. Su
propia cabecera advertía el riesgo con esas palabras: «si algún día divergen, este archivo dice
cuál era la intención». Divergieron.

Reescrito contra las funciones reales, y con la pregunta que faltaba: antes solo contestaba
**«quién entra»**, nunca **«qué ve dentro»**. Por eso el hueco sobrevivió un día. 40/40 casos.

La guardia nueva es la que importa: **existe alguien que entra y no ve empresa.** Si esas dos
funciones volvieran a coincidir, todo lo demás seguiría verde y el gate por bloque dejaría de
tener sentido sin que nadie lo note.

#### `scripts/prueba-vista-por-nivel.js` — un `*ngIf` no es una función que se pueda llamar

Es lo único capaz de cazar esta clase de fuga. Sirve el `dist/`, inyecta la sesión en
`localStorage` antes de que arranque Angular, deja pintar y **cuenta nodos**. `/api/*` devuelve
listas vacías a propósito: lo que se mide es el **gate**, no el dato.

    ruta            sesión       tablero árbol unidades cifra-emp hueco  cae en
    /home           global          1      0      10        1       0    /home
    /home           limitado        1      0       0        0       1    /home
    /home           encargada       1      0       0        0       1    /home
    /home           anaquelista     0      0       0        0       0    /tareas-manual
    /tareas-manual  global          0      1       —        —       —
    /tareas-manual  encargada       0      1       —        —       —
    /tareas-manual  anaquelista     0      0       —        —       —

Aborta si **alguna sesión no se pudo medir** (un `unidades: 0` por «está gateado» y por «la app
no arrancó» se ven idénticos) y aborta si **ningún eje discrimina**. Hoy discriminan 5 de 5.

**Los dos controles negativos, corridos:**
- quitar el `*ngIf` del bloque de unidades → la Encargada vuelve a `unidades: 10`, `bloques: 8`.
  Restaurado → 0 y 7.
- `verNivelEmpresa = esJefatura` → **7 de 16** casos revientan, y uno reproduce **la cadena
  literal que estaba en pantalla**: `Expected 'Dirección · Canindo' to be 'Mi alcance · Canindo'`.

#### El hueco que había dejado abierto, cerrado — y por qué no se podía medir

El gate del árbol del organigrama estaba verificado **por código y no por comportamiento**.
Medido: un anaquelista ve `arbol: 0` mientras global y encargada ven `arbol: 1`.

No salía porque **Git Bash convierte `/tareas-manual` en `C:/Program Files/Git/tareas-manual`**
al pasarlo por variable de entorno. La URL salía malformada, Chrome abría la pestaña nueva, y el
DOM llegaba vacío — que se lee como «la app no pinta». Es **el mismo mordisco de MSYS** que dio
los ceros falsos del 31/ago con `origin/main:.github/...`. La ruta se arma ahora dentro del
script, con la barra puesta por código, y está comentado por qué.

#### Tres verificadores mintieron el mismo día, y todos por el parser

Vale más que las correcciones, porque es el patrón:

1. **El de tokens CSS mintió dos veces en tres líneas.** `head -80` cortaba la lista de tokens, y
   el ancla `^\s*--` solo veía el primero de cada renglón —`styles.css` declara varios por línea—.
   Reportó **18 tokens faltantes que llevan meses en producción**, entre ellos `--sp-3` y
   `--fw-bold`, usados diez veces en la pantalla que estaba mirando. Corregido: 40 usados,
   0 faltantes, con control negativo que caza un token inventado.
2. **El de marcadores en producción buscó en el archivo equivocado.** El tablero va en un chunk
   *lazy*; buscarlo en `main-*.js` y en `styles-*.css` daba cero **por mirar donde no está**. Lo
   delató el **control positivo**: `td-unidad = 0` cuando el tablero llevaba un día desplegado.
   Reescrito para recorrer los **58 archivos de código** del `ngsw.json` (4.29 MB) y **abortar si
   alguno no se pudo leer**.
3. **Y antes de eso, la URL estaba mal.** `mdtask.up.railway.app` no existe; es
   `mdtask-production-ed88.up.railway.app`. Devolvía 101 bytes y tres ceros perfectos. Lo cazó
   imprimir **el tamaño de la entrada** antes de concluir — §8.11(a), literal.
   **Y el 404 venía con cuerpo**, que es lo que lo volvía creíble: el edge de Railway responde
   `404` con `x-railway-fallback: true` y 101 bytes de JSON cuando el host no tiene servicio
   detrás. Un `grep` sobre eso **no falla** — solo no encuentra nada. Por eso el nombre del host
   se lee del repo (4 apariciones) y nunca se escribe de memoria.

**Regla que dejan, y es una sola:** los tres ceros eran creíbles. Ninguno se cayó por sí mismo;
los tres los tumbó una cifra al lado —el tamaño de la entrada, el conteo de la lista, el control
positivo—. **El cero nunca se defiende solo.**

**Marcador que no sirve, y por qué se validan en las dos direcciones:** `Mi alcance` ya valía
**1** en producción antes del cambio (está en `personal.html:369`). Como marcador habría dado
verde sin desplegar nada. Los tres que sí sirven: `td-bloque-hueco` 0→3, `esEmpresa` 0→2,
`td-bloque` 8→13, con `td-unidad` 15→15 como control de que no se rompió el resto.

---

### 2–3/sep/2026 — el resto de los dos días, en orden

**Sistema de diseño «Mercado», aplicado a toda la app.** 75 tokens en `styles.css` más un puente
que remapea los 14 heredados (`--primary-blue → var(--action)`, `--shadow → none`). De 2 548
literales hexadecimales a 896, con un guardián de diff que prueba que **solo cambiaron colores**.
Un defecto del bloque tal como venía dado: `body.theme-monochrome` redefinía `--ink-rgb` pero los
`--overlay-*` se declaran en `:root` **y una propiedad cuyo valor contiene `var()` se sustituye
en el elemento donde se declara** — así que el modo oscuro nunca volteaba los overlays. Arreglado
redeclarándolos dentro de `body.theme-monochrome`.

**El Tablero de Dirección** reemplazó el `/home` anterior completo (cuatro medidores, alertas,
mapa, tendencia). La pieza que importa no es visual: `indicador.util.ts` hace que **una cifra no
pueda compilar sin su denominador** —`{ estado: 'medido'; valor: number; de: number }`— y que
«sin dato» y «sin muestra» sean estados propios con su motivo. Un día sin muestra sale **rayado y
sin valor**, no en cero: una gráfica que baja bonito hasta el piso afirma que hubo medición.

**El organigrama como pirámide, y dos pestañas se volvieron una.** `arbolOrganigrama()` construye
el árbol desde `reportaA` (1 raíz, 0 ciclos, profundidad 4) con una propiedad que se escribió a
propósito: **cualquier puesto que el recorrido no visite se vuelve raíz**, así que nadie se pierde
en silencio. Todo arranca colapsado; el signal guarda los **abiertos**, no los cerrados, para que
el conjunto vacío sea el estado inicial correcto. Y `compararPorOrganigrama()` ordena personas
por su posición en el árbol, con los desconocidos al final —**visibles**, nunca rellenados por
parecido (§8.5).

**Privilegios por rango:** `alcance.util.ts` (`Amplitud` ordenada, `veMasQue`, `esJefatura`,
`hayTableroPara`, `verNivelEmpresa`). `esJefatura` = admin **o** tiene subordinados **o**
`esSupervisor`, y ese último es la red para las fichas sin puesto, que hoy son decenas.

**Y `home.guard.ts`, que arregla algo que yo introduje.** Al poner el tablero nuevo, `/home` se
quedó con tres bloques y una colaboradora entraba a ver el título, el saludo y **nada más**.
Esconder la entrada del menú no lo arregla: `/home` es el aterrizaje por defecto, se llega sin
tocar el menú. Ahora quien no tiene tablero va a `/tareas-manual` por `UrlTree`.

**Los tres los cazó David en pantalla, no yo midiendo.** «Este solo lo deben de ver las
jefaturas», «si no puede ver nada de aquí, ¿crees que esté bien que se lo mostremos?», «cómo
vamos a mostrarle esto si en la jerarquía es de lo más bajo porque es anaquelista». Los tres eran
**fugas de privilegio que yo había desplegado**, y las tres se ven en tres segundos con una
cuenta real y en ningún segundo leyendo el código. De ahí salió el arnés de arriba.

#### Lo que NO está hecho, dicho para que no se lea como resuelto

- **El tablero por nivel para gerencias y Encargadas no existe.** Es Fase 6 y necesita antes la
  plaza y la verificación con muestra. Hoy una Encargada ve sus cifras y un bloque que le explica
  qué le falta. Eso **no** es su tablero.
- **Nadie ha entrado con una cuenta real** a comprobarlo. Las siete combinaciones se midieron con
  sesiones sintéticas en Chrome headless, que es mucho más fuerte que leer código pero **no es lo
  mismo** que una Encargada abriendo la app.
- **17 commits existen solo en esta laptop y en producción.** `git push` devuelve «Repository not
  found»: hacen falta las credenciales de David. Railway despliega del directorio de trabajo, así
  que producción está al día y **GitHub está 17 commits atrás** — con la consecuencia de §1:
  cualquier cambio a los workflows programados **no surte efecto** hasta que eso se resuelva.


### La primera prueba del proyecto sobre quién ve qué

`scripts/prueba-menu-audiencias.js` — no necesita credenciales ni base, corre en segundos.

Tapa un hueco real del paso 4.1: el criterio de aceptación comparó **el conjunto de rutas** del
`NAV` contra el `sidebar.html` anterior, y eso atrapó tres rutas caídas. Pero **no comprobó quién
las ve**: un predicado que quedara más estricto —una entrada que antes veía una trabajadora y
ahora pide `esAdmin`— pasaba ese chequeo sin ruido. Y el `grep` sobre el bundle confirma que el
código se sirvió, no que el menú se pinte bien.

Compara cuatro usuarios sintéticos —admin global, admin de sucursales, supervisora con banderas,
operadora sin ninguna— y **ninguna de las dos lógicas se transcribe**: las condiciones viejas se
leen de git, y las nuevas salen de **compilar `nav.config.ts` y llamar al `menuDe()` real**.

**Resultado al 31/ago: los DIEZ perfiles ven exactamente las mismas rutas que antes.** Los cuatro
estructurales (15, 14, 11 y 4) más **seis de promos, uno por permiso**.

Esos seis no eran un extra: los cuatro primeros **no tenían ninguna bandera de promos**, así que
los dos lados devolvían `false` para `/promociones` y `/venta-promos` y **el verde pasaba sin
ejercer esos predicados** — el mismo fallo del control que pasa por el camino equivocado, aquí por
omisión. Y son justo los más frágiles: no eran banderas simples sino getters con **tres permisos
cada uno**, donde basta cualquiera. Un `&&` donde iba un `||` dejaría fuera a dos tercios de la
gente de promociones sin que nadie lo note hasta que reclamen. La prueba ahora **aborta** si
ningún perfil llega a ver esas dos rutas. Y de paso mide el pendiente: un admin global ve **15**, y el objetivo del documento 4 son
**7** — la diferencia es el paso 4.1b.

**Hay que volver a correrla antes del paso 4.3**, que reemplaza los predicados por la función de
alcance. Sin ella no habría forma de saber si ese reemplazo cambió audiencias.

**Y la prueba se caducó a sí misma un commit después de escribirla.** Estaba anclada a `HEAD~1`,
así que en cuanto se commiteó *la propia prueba*, `HEAD~1` ya era el sidebar nuevo: se comparaba
contra sí misma y marcaba las 15 rutas como «ganadas». Es el corolario (e) —un control anclado a
algo que se mueve caduca— aplicándose **a la prueba escrita para ese corolario, el mismo día**.

Peor: el guardián no lo detectó, porque el sidebar nuevo conserva un `nav-item` (el de Perfil, en
el pie), así que `viejas.size === 0` era falso y la comparación pasaba. Corregido con el SHA fijo
`78b89a3` y una guardia que exige que el commit de referencia **tenga las condiciones de permiso**
—las 11 que el paso 4.1 eliminó—, que es la marca real de «este commit es anterior al cambio».
Probados los dos caminos: con el SHA bueno pasa, con `HEAD~1` aborta explicando por qué.

### 4.1b — las cuatro pantallas de análisis son una, con pestañas

`/estadisticas`, `/ranking-sucursales`, `/productividad` y `/checkstore` pasaron a ser
pestañas de `/control`. **Cuatro entradas de menú se volvieron una: 15 → 12** para un admin
global. El objetivo del documento 4 son **7**; los cinco que faltan son el Paso 3.

Las cuatro rutas viejas **siguen vivas como `redirectTo`** a su pestaña, y cada una en el
mismo commit en que su plantilla perdió el marco — si la ruta siguiera sirviendo el
componente, esa URL mostraría una pantalla sin sidebar. **Ningún `.ts` de las cuatro se
tocó** (`git diff` vacío en los cuatro): solo perdieron header, sidebar y overlay, que ahora
monta el cascarón una sola vez.

**El riesgo de esta fusión nunca fue romper: era ESCALAR PRIVILEGIOS.** Las cuatro tenían
permisos distintos, y Sucursales es la más estrecha (no incluye `puedeVerEstadisticas`). Si
el cascarón se viera con la unión, quien solo tenía Sucursales se llevaría Estadísticas de
regalo. La regla quedó de dos niveles y en **un solo archivo** (`control.tabs.ts`): el
cascarón se ve si se ve al menos una pestaña; cada pestaña se gatea por su propio permiso,
con el mismo `ve` que usan la barra, el guard de la ruta hija y el menú.

**Lo que enseñó el paso 2b y no estaba en el plan:** hasta 2a lo único sin verificar era
estático —se pinta o no se pinta—, y de eso el build cubre casi todo. **Desde que hay dos
pestañas hay comportamiento** —montar, destruir, recrear, redirigir— y **el build no ejecuta
nada: compila.** De ahí salió el arreglo del scroll (`.content` tiene `overflow-y: auto` y
conservaba su posición al cambiar de hijo: bajabas media página en Estadísticas y aterrizabas
a media página en Ranking). Es una línea, y costaba lo mismo hoy que dentro de un mes: la
diferencia era si la encontraba yo o una Encargada.

**Dos miradas de treinta segundos, y ven cosas distintas.** Con dos pestañas: que la pantalla
aparezca dentro del cascarón, la línea de la barra de borde a borde, el cambio de pestaña y el
scroll. Con cuatro: que la barra no envuelva feo en móvil y que las cuatro quepan — con dos,
`flex-wrap` no envuelve nunca, así que esa pregunta **no existía** todavía.

### La prueba de audiencias ahora ve las escaladas, no solo las pérdidas

`prueba-menu-audiencias.js` comparaba **rutas del menú**, y desde 2b las cuatro fusiones
aterrizan en la misma: `/control`. Ahí las pestañas son indistinguibles — un perfil «gana
/control» una sola vez y basta haber tenido UNA de las cuatro pantallas para pasar en verde;
**las otras tres viajaban de polizón.**

Ahora recorre las pestañas de cada perfil y exige que cada una sea **reclamable** por una
pantalla que ese perfil ya veía.

**Y escribir el caso no bastaba** — es el corolario (c) por una puerta nueva. Los diez
perfiles veían las **cuatro pestañas o ninguna**, así que el chequeo recorría sin comparar un
solo `ve` contra el de al lado. Hicieron falta dos perfiles de **subconjunto estricto**, y no
el mismo subconjunto:

| perfil | ve | no ve |
|---|---|---|
| solo `puedeVerCheckstore` | ranking, productividad, sucursales | **estadísticas** |
| solo `puedeVerEstadisticas` | estadísticas, ranking, productividad | **sucursales** |

Entre los dos, cada pestaña queda excluida de al menos un perfil. Y la prueba **aborta** si
algún día nadie ejerce un subconjunto estricto, o si el recorrido sale en cero — un cero ahí
no es «sin escaladas», es «sin medir».

**Control negativo corrido:** ensanchar el `ve` de Sucursales con `puedeVerEstadisticas` la
hace salir con código 2, nombrando la pestaña y el perfil correctos; restaurada, vuelve a 0.
(Al primer intento el reemplazo pegó en la línea equivocada —Ranking, que ya era ancha— y el
no-op dio un verde que casi leo como «el control no detecta». **Un control negativo que no
cambia nada prueba tanto como un cero sin denominador.**)

### Y comprueba que las rutas VIEJAS aterricen donde dice la fusión

Los checks de pantalla prueban las rutas nuevas. Las viejas son las que están en el historial
de WhatsApp, y son las únicas que la gente real toca el primer día. **Su modo de fallo no es
visual**: un `redirectTo` cuyo destino no coincide exacto con el segmento del hijo no da error
de compilación — cae al wildcard y manda a login. Verde en el build, rojo en la cara de una
Encargada. Cuatro comprobaciones, sin parsear (se aplastan los espacios y se comparan cadenas):

1. cada pestaña tiene ruta hija **y** va con `tabControlGuard`;
2. no sobra ninguna hija guardada (sería una huérfana de un renombre);
3. cada fusión de `FUNDIDAS` tiene su `redirectTo` realmente escrito;
4. **ninguna ruta vieja sobrevivió sirviendo el componente.**

**El (4) es el que casi no existe, y es el espejo del (2).** El (3) verifica que el
`redirectTo` *exista*, no que la ruta vieja *se haya ido*. Con las dos presentes, Angular toma
la primera que casa, sirve el componente, y el redirect queda muerto: esa URL entrega la
pantalla **sin marco** —justo lo que 2a vino a evitar— con el (3) en verde. Y contar
`path: 'estadisticas'` no discrimina: aparece dos veces con razón. Lo que discrimina es **de
dónde se carga** el componente: uno solo por `loadComponent`. El especificador se lee de la
propia ruta hija, no se escribe en la prueba — y un «sin duplicados» global tampoco servía,
porque `checklist.ts` sirve dos rutas a propósito (hallazgo 4).

**La lección del no-op se cobró el mismo día.** El primer intento de este bloque tenía `\s`
dentro de un *string* de JS, donde `\s` es solo `s`: la regex no habría casado nunca, el
renombre habría sido un no-op y el chequeo habría dado verde **sin mirar nada**. Lo cazó la
guardia «el control negativo no cambió nada», escrita dos horas antes por el mismo motivo.
Reescrito sin regex. Corolario para §8.11(c): **un control negativo que no cambia nada prueba
tanto como un cero sin denominador** — y es peor que un control roto, porque el roto te manda
a investigar y el no-op te manda a confiar.

### `version.ts` dejó de rastrearse, y por qué eso era un riesgo

`scripts/generar-version.js` lo reescribe en cada `npm run build`, así que llevaba **todo el
día modificado** en el árbol. Un archivo que siempre aparece sucio es un archivo que deja de
leerse: obliga a filtrar mentalmente cada `git status`, y así un `git add -u` lo coló en un
commit cuyo mensaje hablaba solo del scroll. Daño cero —Railway lo regenera al construir— pero
el mensaje decía una cosa y el commit contenía otra, que es la familia de fallas del día.

No rompe el clon limpio: `build` y `start` son `node scripts/generar-version.js && ng ...`, y
el Dockerfile corre `npm run build`, así que existe antes de que `login.ts` y
`mantenimiento.ts` lo importen.

### 1/sep/2026 — «no funciona»: el servidor estaba sano y el rescate estaba adentro

David no podía entrar. Se descartó **todo** el lado del servidor con cifras antes de tocar nada:
58/58 hashes de `ngsw.json`, 16/16 archivos del `index.html` en `200`, `/api/login-usuario` en
356 ms, `/api/usuarios` en 222 ms, Firebase Auth con llave **válida**
(`INVALID_LOGIN_CREDENTIALS` ante un usuario falso), `migraciones al día`, sin CSP, mantenimiento
apagado desde el 29/ago.

**Lo que lo cerró fue abrir la app yo mismo.** Chrome headless con perfil limpio pintó el login
completo —`app-root` con 2822 bytes, incluido el marcador de versión—. Misma URL, dos perfiles,
uno abre y el otro no: la diferencia es lo único que no comparten, el estado guardado en el
navegador. **Eso es una herramienta nueva y hay que usarla antes de preguntar:** dos turnos se
fueron en pedir síntomas que un navegador headless contesta solo.

**Y el hallazgo de fondo:** `app.ts` ya sabía recuperarse de un chunk viejo, pero **el reparador
vivía dentro de lo que no arranca**. Si el worker sirve un `index.html` guardado cuyos chunks ya
no existen, el arranque falla y nada de esa maquinaria corre. Se agregó un `<script>` **inline en
`src/index.html`** —lo único que se ejecuta aunque `main.js` devuelva 404—. Límite honesto: no
rescata a quien YA está atascado (ese navegador tiene el index viejo, sin el guardián); protege
desde el despliegue siguiente.

**Dos fallas del andamio, las dos de la misma familia del día:**
- La prueba servía el index roto a la primera petición de `/`, y **la sonda de «¿ya levantó el
  servidor?» se lo comía**: el navegador recibía el sano, la app arrancaba, y el verde no probaba
  nada. Se destapó al imprimir `Sec-Fetch-Mode` de cada petición. Ahora solo se rompen las
  navegaciones, y la prueba **aborta si el 404 del chunk fantasma no aparece** en el log.
- `execFileSync` **bloquea el event loop**, y el servidor HTTP vivía en el mismo proceso: la
  prueba se ahogaba sola y moría por timeout — que se lee como «el rescate no funciona» cuando lo
  que no funciona es la prueba. Reescrita asíncrona.

`scripts/prueba-rescate-arranque.js` deja las dos preguntas corriendo solas, y **el negativo pesa
más que el positivo**: un rescate que recarga cuando no debe es un bucle para 186 personas.

    NEGATIVO  index sano  -> 1 navegación, app-root 2823 bytes (no recarga)
    POSITIVO  index roto  -> 404 del chunk fantasma, 2 navegaciones, 2823 bytes

**Y un falso positivo más, en la propia espera del despliegue:** `grep -c ... || echo 0` imprime
`0` **y además** ejecuta el `echo`, así que la variable quedaba `"0
0"` y el `if` daba verde en
el primer intento con la app vieja todavía servida. El `last-modified` lo delató.

### El cuelgue de «VERIFICANDO...» — cinco `await` sin tope, y el peor era el último

El síntoma real no era «no abre»: era **«ingreso los datos y el botón se queda en
VERIFICANDO...»**. Ese texto sale de `login.html:53` (`ingresando ? 'VERIFICANDO...' : ...`), así
que la palabra que David usó **localizaba el archivo** — dos turnos se fueron buscando en el
lugar equivocado por no preguntar antes qué decía el botón.

**Y `ingresar()` tiene un `finally` que apaga esa bandera.** Con el `finally` presente, un
spinner eterno **no puede ser un error atrapado**: es un `await` que nunca vuelve. No hay
excepción, no hay nada en la consola, y desde fuera «no me deja entrar» se ve idéntico esté la
contraseña mal, la red bloqueada o el perfil incompleto. Eso es lo que hizo que las cinco horas
de diagnóstico no encontraran nada: no había nada que encontrar, había un silencio.

**El peor de los cinco, y por qué:** `await navigator.storage.persist()` está **después** de
guardar `md_sesion_actual`. Si se colgaba ahí, la sesión **ya estaba guardada**: la persona
quedaba autenticada, mirando «VERIFICANDO...» para siempre, y **con recargar entraba**. El login
había funcionado y la pantalla decía lo contrario. Pedir almacenamiento persistente es una
mejora, no un requisito: **nada opcional merece bloquear el acceso de nadie.** Ahora va sin
`await`.

Los otros cuatro llevan tope **con nombre del paso** —buscar tu usuario 15s, validar tu
contraseña 20s, obtener tu credencial 15s, leer tu perfil 15s, más los dos `res.json()` a 10s—.

**Y un tope NO SE TRAGA.** Los dos `try/catch` internos se comían cualquier fallo y mostraban
«Usuario no encontrado» o «Perfil incompleto»: eso manda a revisar la base cuando lo que hubo fue
una espera sin respuesta. Los topes se relanzan y la pantalla dice «Se agotó el tiempo al
\<paso\>. No es tu contraseña».

**Lo que se arregló no es el tope: es que el síntoma dejó de ser un misterio y pasó a ser una
frase.** Firebase Auth vive en `identitytoolkit.googleapis.com`, otro dominio: una red que deja
pasar `railway.app` y bloquea `googleapis.com` produce exactamente este cuelgue. Antes se
callaba; ahora lo nombra.

**Regla que deja, y es de diagnóstico antes que de código:** cuando alguien reporta un síntoma,
**pregunta el texto literal que ve en pantalla antes de investigar**. `grep` sobre esa cadena
localiza el archivo en un segundo. Aquí se probaron hashes, endpoints, Firebase, CSP,
mantenimiento y service workers —todo sano— cuando la palabra «verificar» ya apuntaba a
`login.html:53`.

### 1/sep/2026 — Mercado en las pantallas de tareas, y dos defectos que solo se ven midiendo

Puro estilo y plantilla: `checklist.ts` no se abrió (`git diff` vacío), sin migraciones.

**El bug de verdad no era cosmético.** `.org-puesto-datos` era un `flex` y cada pastilla traía su
`*ngIf`: cuando el dato faltaba **se borraba la RANURA**, no solo el contenido, y las de la
derecha se recorrían. El mismo lugar decía «88 puestos debajo» en Dirección General y «3 tareas
del manual» en Almacenista. Ahora es una rejilla de cinco columnas fijas con un `.org-slot` que
existe siempre, y un encabezado que **reusa `.org-puesto-datos`** en vez de repetir las anchuras:
no pueden desalinearse porque solo hay una definición.

**La causa raíz de todo el azul era una línea.** `:host { --primary-blue: #1E40AF }` en
`checklist.css:3`: el componente **redefinía el token en vez de usarlo**, así que el remapeo
global a sunset nunca le llegaba. 82 azules → 0, con el rol leído del **selector**, no del
parecido de color.

**Los dos hallazgos que la medición dio y el ojo no habría dado:**

1. **El encabezado se salía 94 px.** Los 25 ejes derechos de las filas daban un solo valor
   —1079— y el del encabezado, 1173: yo había topado el ancho de la tarjeta y no el suyo. En
   pantalla se ve como «casi alineado».
2. **El volteo automático de los overlays NO funciona**, y es un defecto del bloque de tokens,
   no de esta pantalla. `--overlay-*` se declara en `:root` como `rgba(var(--ink-rgb), a)`, y una
   custom property con `var()` adentro **se sustituye donde se declara**. El bloque oscuro cambia
   `--ink-rgb` en `body`, que es hijo: los overlays ya venían sustituidos con la tinta clara.
   Medido en oscuro: `--overlay-hover` daba `rgba(16,13,9,.043)` — un velo casi negro sobre fondo
   negro, o sea **hover invisible**. A ojo parece «no tiene hover». Corregido redeclarando los
   tres overlays en el bloque oscuro; **afecta a toda la app**.

**Aceptación medida, no mirada:** 82→0 · 22→0 · los archivos **crecieron** (3716→3769, 347→386),
así que el cero no vino de borrar líneas · 25 ejes en un solo valor · checkbox en 1198 dentro de
1216 · en oscuro `--overlay-hover` = `rgba(251,249,246,.043)`.

**Una corrección al conteo de entrada:** la línea base decía 66 azules y me dieron **82**. No es
que el árbol cambiara — en `9f76b5f`, anterior a todo el design system, ya eran 82. El número
esperado estaba mal, y comprobarlo contra un commit viejo es lo que distingue «el árbol cambió»
de «el conteo estaba mal».

**Pendiente declarado:** fundir «Pendientes/Enviadas» en la fila de ESTADO, y la barra de
«Avance del día» que parece llena con cero cumplido, viven en `panel-responsables.html/.css`,
fuera de la lista de archivos de ese paso. No se tocaron.

### 1/sep/2026 — LA CAÍDA: el sidebar se reconstruía en cada ciclo

**Causa única.** `sidebar.ts:47` era `menu() { return menuDe(this.currentUser); }`, y `menuDe()`
construye un arreglo **nuevo** en cada llamada. `sidebar.html:21` hace `*ngFor` sobre `menu()`,
con otro `*ngFor` anidado y un `[ngSwitch]` de 21 SVG dentro. Angular llama `menu()` en **cada
ciclo de detección de cambios** y compara por identidad: veía un arreglo nuevo siempre, así que
destruía y recreaba las 21 entradas —con sus `routerLinkActive`, que se re-suscriben— en cada
click, cada respuesta HTTP y cada tick de los cuatro polls. Reconstrucción continua.

Arreglo: memoización por identidad de `currentUser`. Vale porque `currentUser` llega por
`@Input()` desde un **campo plano** del padre (`home.ts:39`), no de un getter que fabrique
objetos — se verificó antes de aplicarlo, porque con un getter el parche no habría servido de
nada.

**`login.html` NO monta `<app-sidebar>` (0 ocurrencias).** Por eso «se congela al iniciar sesión»
no era el formulario: el congelamiento llega al navegar a `/home`, que es el instante en que se
entra. Confirmarlo evitó buscar en el archivo equivocado.

**La medición, y su denominador.** Mismo Chrome, mismos flags, misma máquina; sesión sembrada en
`localStorage` (basta: `auth.guard.ts` solo mira esa llave y `home.ts:759` saca de ahí el
`currentUser`), y 20 ciclos de detección forzados con clicks en la hamburguesa, contando
mutaciones del nav con un `MutationObserver`:

| build | sidebar montado | DOM devuelto |
|---|---|---|
| sin parche | **sí** | **0 bytes — nunca terminó** (2 de 2) |
| sin parche | **no** (sin sesión) | 2823 bytes ✓ |
| con parche | sí | 36511 bytes · **mutaciones = 0** (3 de 3) |
| **producción 15:26** | sí | **36511 bytes · mutaciones = 0** |

Ese `0 bytes` **es** el congelamiento: la página nunca alcanza reposo, el tiempo virtual de Chrome
no drena y `--dump-dom` no emite. La fila del control —mismo build, sidebar fuera— es la que
prueba que era el sidebar y no el build. Y la última se midió **bajando los 62 archivos que
producción sirve**, no la copia local.

**Lo que costó caro fue el diagnóstico, no el arreglo.** Se probaron hashes, endpoints, Firebase,
CSP, mantenimiento y service workers —todo sano— antes de mirar el sidebar. Dos reglas que deja:

- **Pregunta el texto literal de la pantalla antes de investigar.** «VERIFICANDO...» estaba en
  `login.html:53` y localizaba el archivo en un `grep`.
- **Abre la app tú mismo con Chrome headless antes de pedir síntomas.** Perfil limpio contra
  producción contesta en segundos «¿abre o no abre?», y compararlo con el perfil de la persona
  aísla si el problema es el servidor o su navegador.

**Y una trampa del andamio:** un `timeout` de la medición dejó el `sidebar.ts` viejo en el árbol
de trabajo unos minutos. Producción nunca lo vio —el despliegue salió antes—, pero `dist/` quedó
construido del código viejo. Si algo se hubiera medido contra ese `dist/` sin darse cuenta, la
conclusión habría sido la contraria. **Después de restaurar un archivo, reconstruir.**

### 4.1b DESPLEGADO — 1/sep/2026 14:37:59 GMT

Verificado en producción, con marcador validado en las dos direcciones:

| marcador | servido | qué prueba |
|---|---|---|
| `md_rescate_arranque` | 1 (en el index) | el rescate está vivo |
| `ctl-tab` | 1 | la barra de pestañas |
| `Control operativo` | 2 | la entrada nueva del menú |
| `alCambiarPestana` | 1 | el scroll vuelve arriba |
| `Productividad y turno` | **1** (antes 2) | dejó de ser entrada: hoy es pestaña |

Más: **62/62** hashes de `ngsw.json` coinciden, 0 faltantes, y Chrome headless con perfil limpio
pinta el login (`app-root` 2822 bytes).

**Lo que este despliegue NO verificó: las cuatro pestañas por dentro.** Nadie con sesión las ha
visto. Faltan los seis checks visuales —dentro del cascarón · línea de borde a borde · cambio de
pestaña · scroll · que las cuatro quepan en móvil · las cuatro URLs viejas—, y ahora se hacen en
producción porque el paso local ya no existe.

### Listo y SIN DESPLEGAR — el orden importa


**`053_desactivar_correo_compartido.sql` está commiteada pero NO desplegada, a propósito.**
Desactiva `Miriam` y `EL DAVE`, y esas dos son hoy las únicas fichas conocidas que ejercen la
**cubeta E** de `diagnostico-asignaciones-huerfanas.js` —el mecanismo del selector—. Si la
migración corre antes del script, pasan a inactivas, caen en la cubeta B, y **la medición se
destruye sin poder recuperarla** sin reactivarlas.

Orden obligatorio: **medir → desplegar la 053**, y el despliegue **cuando el piso ya cerró**
(cada `railway up` cambia los hashes de los chunks).

**`scripts/sql/pendientes/054_yadira_campero.sql`** está escrita y **no se aplica sola**:
`db-migrate.js` hace `readdirSync` sobre `scripts/sql` **sin recursión**, así que la subcarpeta
es invisible para el runner. Verificado: el runner lista 53 archivos y ninguno es la 054. Si
viviera un nivel arriba, el próximo despliegue la ejecutaría y **adivinaría** la respuesta que
todavía no tenemos. Lleva dos candados propios: aborta si `v_ficha_vigente` sigue en `'PENDIENTE'`,
y aborta si la ficha a desactivar **ya tiene trabajo real** — o sea, si el reloj ya corrió.

**El control positivo de huérfanas dejó de poder caducar.** En vez de re-anclarlo a otro par de
nombres, ahora se construye **desde los datos**: busca cualquier ficha activa sin sucursal con
trabajo en una sucursal real y exige que ese checklist esté en E. Si no existe ninguno, lo **dice**
—«el mecanismo quedó sin verificar», código 3— en vez de fingir un fallo de consulta. Y distingue
las dos lecturas posibles de ese vacío: que el hueco se cerró, o que la consulta ya no lo detecta.

### Mañana, el arranque

Corto, y en este orden:

1. **El mensaje a la Gerente de Morelia Abastos:** «avísame antes de pedirle a Yadira que empiece
   a entrar». Es el único pendiente que se vuelve **irreparable** si se hace en el otro orden —
   en cuanto ella abra la app, las dos fichas tienen trabajo real y la fusión queda bloqueada.
2. Los dos scripts con la `DATABASE_URL` pública a mano: `diagnostico-divergencia.js` (paso 0.2)
   y `diagnostico-silencio-por-unidad.js` (la partición que desbloquea la interpretación).

### La Fase 0 ya se pagó sola

El 31/ago/2026 el proyecto ganó **tres hallazgos que no estaban en ninguno de los cinco
documentos** de la revisión, y los tres salieron del mismo sitio: de ir a **medir antes de
tocar**.

1. **El silencio.** 60 de 97 fichas activas con puesto no han abierto la app en más de 30 días;
   33 nunca. Los tableros estaban leyendo eso como incumplimiento.
2. **La colisión de identidad en el login.** `limit 1` sin `order by` en `api/login.js`: una
   persona entraba a dos cuentas distintas según el día, y una ficha desactivada podía dejarla
   fuera de la app.
3. **El selector que asigna a fichas ajenas.** Una Encargada real puede asignar trabajo a
   cualquier ficha del sistema, incluidas cuentas de prueba de otra plaza.

Ninguno se habría visto leyendo código. Y no salieron de **medir**: salieron de **verificar lo
que se medía** — dos de los tres aparecieron mientras se comprobaba otra cosa. Esa distinción es
lo que vale más que los tres hallazgos juntos, y es de lo que habla la §8.11.



### Marcador corrido: correcciones de identidad por nombre

> Sirve para la Fase 3 mejor que cualquier argumento técnico. «Seis en un día» lo entiende
> Dirección; «0 llaves foráneas en 36 tablas» no.

| # | Fecha | Persona | Qué falló |
|---|---|---|---|
| 1 | 31/ago | Fernando Espitia | ficha sin `puestoId`; el cruce de la 037 no lo alcanzó |
| 2 | 31/ago | Manuel Medina | ficha capturada como **MEDIAN** — un typo lo dejó sin tareas |
| 3 | 31/ago | Francisco Cendejas | baja no reflejada; seguía activo |
| 4 | 31/ago | Nery Ramírez Chavolla | baja no reflejada; seguía activo |
| 5 | 31/ago | María Dolores Berber Tovar | **dos fichas**, apellidos invertidos; la viva tenía 129 tareas y un espacio final en el nombre |
| 6 | 31/ago | Yadira Campero Ortiz | **dos fichas**, una con doble 'a' (**Yaadira**); las dos con tareas → sin resolver |

Patrón: **cuatro de las seis** son la misma falla — la identidad se cruza por texto, así que un
typo, un espacio o un apellido invertido crean una segunda persona que el sistema trata como
real. Y también apareció al revés: `JUAN MANUEL ESPINOZA ALACARAZ` (por *Alcaraz*) cruzó bien
solo porque el typo cayó en la palabra que la llave no usaba.



> Actualiza esto al cerrar cada paso: fecha, paso, qué se movió, qué se aprendió.

- **1/sep/2026 — paso 0.4 ✅ hecho.** `numReplicas = 1` en los 15 service instances de
  `production`, y un único `escuchando en el puerto 8080` en el log. **Nadie recibe WhatsApp
  duplicados y la Fase 9.1 NO hay que adelantarla.** Documentado en `RAILWAY.md`, con el motivo
  por el que no se puede subir de una réplica mientras los cuatro polls vivan dentro de
  `app.listen` sin idempotencia. **Ojo con el proxy equivocado:** contar líneas de «poll
  iniciado» en el log NO sirve — la ventana del log viene truncada y da 2 de 4. La cifra que
  vale es `numReplicas`.
- **Corrección de numeración:** antes esta bitácora llamaba «0.4» al silencio. El silencio no es
  un paso del documento 5: es un **hallazgo** que salió midiendo. El 0.4 son las réplicas.
- **31/ago/2026 — paso 0.3 (adelantado, sin saberlo).** La migración 045 midió la distorsión de
  la regla de cumplimiento: `por_justificacion = 1` punto en toda la empresa. Consecuencia: la
  Fase 2 se adelanta antes de la Fase 1, y el paso 0.3 (congelar KPIs) se reduce a conservar la
  salida de la 045.
- **31/ago/2026 — paso 0.1 ✅ hecho.** Quitado el bloque `schedule` de
  `.github/workflows/robot.yml`; queda solo `workflow_dispatch` y un comentario con el cron
  anterior. Verificado **contra `origin/main`**, que es la única fuente que Actions lee: 51
  líneas traídas del remoto, `schedule:` → 0, `- cron:` → 0, `workflow_dispatch:` → 1. El corte
  de agosto no corrió. Margen: 9 h 20 min.
  - Dos cosas casi arruinan la verificación, y las dos dejaron regla nueva (§8.11):
    el **comentario del propio workflow mentía** ("día 1 a las 3:00 AM" — el cron es UTC, así
    que disparaba a las 21:00 del 31); y la primera verificación dio **ceros falsos** porque Git
    Bash convirtió `origin/main:.github/...` en `origin\main;...`, el comando falló y `grep -c`
    contó sobre entrada vacía. Rehecho en PowerShell.
- **31/ago/2026 — PARAR EL RELOJ DE YADIRA CUESTA UNA FRASE, NO CÓDIGO.**
  El riesgo no es la conversación con su Gerente: es **el primer login de Yadira**. En cuanto
  entre, la ficha con puesto genera historia, las dos tienen trabajo real, y la regla de «un
  empate no se resuelve» bloquea la fusión para siempre.
  Así que el pedido a la Gerente es angosto y fácil de cumplir: **«avísame antes de pedirle que
  empiece a entrar»**. Puede hablar con ella mañana de lo que quiera; lo único que no puede pasar
  es que abra la app antes de que el duplicado esté resuelto.
- **31/ago/2026 — HALLAZGO NUEVO: el selector de personas asigna a fichas ajenas.**
  No es una anécdota de la 052, es un hueco propio. El 22/may a las **13:11:11**, *Claudia
  Pimentel Duran* hizo una asignación en bloque en **La Piedad Abastos** y el selector le ofreció
  dos fichas que no son de esa plaza — una de ellas una cuenta de pruebas (`EL DAVE`). **Una
  Encargada real puede asignar trabajo a cualquier ficha del sistema y nada la detiene.**
  - **Completa el cuadro del silencio:** el robot emite al vacío (60 de 97) **y las personas
    también**. Los dos inflan denominadores que los tableros muestran como incumplimiento.
  - **Nota sobre el endpoint de diagnóstico autenticado:** queda aparcado porque **hoy no hace
    falta**, no porque sea un puente que se demuela. Eso último era falso: `api/db.js` sobrevive
    intacto a la Fase 1 y a la Fase 9. Archivar algo por la razón equivocada hace que dentro de
    dos meses nadie lo reconsidere.
  - **Pendiente, script barato:** cuántos checklists tienen un `assigned` que no corresponde a
    ninguna ficha activa con puesto, y cuántos tienen un `store` que no coincide con las
    sucursales del asignado. El segundo probablemente lleva meses.
- **31/ago/2026 — 052 cierra el correo compartido, y destapa un límite del determinismo.**
  - **`EL DAVE` es dato de pruebas, con evidencia:** 5 checklists de un punto en `SISTEMAS`,
    creados por *Administrador Supremo* el 6, 7 y 8 de mayo — **tres el mismo día en siete
    minutos** (18:37, 18:43, 18:44). Es alguien probando el flujo, no operación.
  - **`Miriam` NO es atribuible, y el `store` lo prueba:** su único checklist está en **La Piedad
    Abastos**, y las dos Miriam de la nómina están en **8 Esquinas** y **Canindo**. Se creó el
    22/may a las 13:11:11, el **mismo segundo** que el sexto de EL DAVE, los dos por *Claudia
    Pimentel Duran*: una asignación en bloque cuyo selector incluyó fichas fantasma ajenas a esa
    plaza. No es de pruebas —la creó una persona real en una sucursal real— pero **no es
    atribuible a nadie**. El filo de privacidad sigue **latente, no realizado**: ninguna de las
    dos se ha abierto jamás.
  - **EL ORDEN PRIORIZA ACCESO SOBRE HISTORIAL, Y ESO ES LO CORRECTO.** La prueba con
    `yadira.campero` devolvió:
    `#1 Yadira Campero Ortiz (puesto=encargado-sucursal, latido 24/jun)` ·
    `#2 Yaadira Campero Ortiz (sin puesto, latido 30/jun)`.
    Gana la #1 por tener puesto, aunque la #2 tenga el latido más reciente. **No es un defecto:**
    mira qué ve ella en cada una. En Yaadira —historial, sin puesto— vería sus 17 checklists
    viejos y **nada nuevo**, porque el robot emite por `puestoId` y esa ficha no tiene. En Yadira
    ve el trabajo de hoy y no ve su historia. Para alguien que necesita trabajar, la segunda es la
    buena: **perder de vista el historial es un problema de reporte; no poder ver tus tareas es un
    problema de acceso, y un login se ordena por acceso.** El historial se recupera al resolver el
    duplicado. **No cambies este orden creyendo que es una deuda.**
  - **RIESGO CON RELOJ, y es el que nadie había nombrado.** El día que su Gerente le diga «empieza
    a usar la app», ella va a aterrizar en la ficha con puesto y va a **generar historia ahí**. En
    ese momento las dos fichas tienen trabajo real y la regla de «un empate no se resuelve»
    **bloquea la fusión**. Así que el orden de los movimientos importa: **resolver el duplicado
    ANTES de la conversación con la Gerente, no después.** Hoy el reloj está parado porque nadie
    entra desde junio; arranca el primer día que alguien la anime a entrar.
- **31/ago/2026 — `login.js` arreglado y VERIFICADO, sin que nadie iniciara sesión.**
  - **El orden estable** quedó en `api/login.js` y `api/login-usuario.js`, idéntico en los dos:
    activas primero, luego con puesto, luego latido más reciente, `id` como desempate. Si los
    dos no ordenaran igual, `login-usuario` podría devolver un correo distinto al que `login`
    elige y la incoherencia seguiría viva aunque cada uno fuera determinista por separado.
  - **Tercera consecuencia del `limit 1`, que no se había visto:** la comprobación de
    `activo === false` está **después** de validar la contraseña. Si la ficha desactivada ganaba
    el sorteo, la persona quedaba **fuera de la app** aunque existiera una activa con su mismo
    usuario. Eso hace del orden por `activo` una protección, no una cosmética.
  - **Verificado con un intento fallido, sin tocar la cuenta de nadie:** un POST a `/api/login`
    con `mataviejitas778@gmail.com` y contraseña deliberadamente incorrecta devolvió 401 y el log
    gritó `[login] COLISION DE IDENTIDAD ... 2 fichas -> …:Miriam | …:EL DAVE`. El
    `console.error` está en la línea 82 y `verificarPassword` en la 88, así que **una colisión es
    observable también en los intentos fallidos** — que es donde tiene que verse.
  - **Regla nueva que deja:** `mataviejitas778@gmail.com` debe salir como dirección de una cuenta
    de producción, sea de quien sea. El día que aparezca en una captura frente a Dirección o a un
    auditor, la conversación va a ser sobre eso y no sobre la operación.
- **31/ago/2026 — la ficha "Miriam" no es "real o de pruebas": es NO ATRIBUIBLE.**
  - En la nómina hay **dos** Miriam, las dos en sucursal: `CARRILLO CONTRERAS MIRIAM JAZMIN`
    (Cajera, 8 Esquinas) y `RODRIGUEZ SANCHEZ MIRIAM JUDITH` (Anaquelista, Canindo). Así que
    aunque se decidiera que la ficha es una persona, **no se puede decir cuál**. El criterio pasa
    de «real o de pruebas» a «ficha no atribuible con acceso potencial a una cuenta compartida».
  - **Mi criterio de la 051 era flojo, y fijarlo por adelantado no lo volvió bueno.** Lo único
    que disparó "parece real" fue `checklists > 0`, y un checklist asignado prueba que **alguien
    escribió ese nombre**, no que exista una persona que use la cuenta. Metí como evidencia de
    identidad justo el dato que el hallazgo 1 vuelve poco fiable. Las dos señales fuertes
    —latido y puesto— están ausentes en ambas fichas. Revisar el criterio cuando llegó el dato
    **sí** es el método funcionando; lo que falló fue el criterio, no la disciplina.
  - **El discriminador ya estaba en la tabla:** `store` del checklist, con `created_by` y
    `timestamp_creacion`. Va en la 052.
- **31/ago/2026 — la guardia de un diagnóstico es de COBERTURA, no de totales.**
  Al escribir el split por unidad iba a validar «parseé 89 puestos y 11 unidades». No sirve: 89
  con uno malformado y otro contado doble también da 89. La guardia que importa es que **todo
  `puestoId` presente en la base exista en el catálogo parseado**, y si falta uno, abortar con la
  lista — porque ése es justo el que iba a quedar sin unidad y a desaparecer del reporte en
  silencio. Es la regla del cero falso afinada: **verifica la entrada que de verdad usas, no un
  proxy de ella.** (Y el parseo se contrastó contra un `grep` independiente: 89 y 89.)
- **31/ago/2026 — el tercer número de la Fase 0: EL SILENCIO. Medido; interpretación PENDIENTE.**
  - **El dato, con su denominador:** de **97** fichas activas **con puesto**, **60 están en
    silencio** — **33 nunca han entrado**, 13 sin entrar hace más de 60 días, 14 entre 30 y 60.
    Sobre **150** fichas activas en total. Fuente: migración 050.
  - **NO se escribe todavía qué significa.** La lectura fácil —"el 62% no usa el sistema"— es una
    media verdad, y una media verdad en el contexto permanente se vuelve doctrina en dos semanas.
    Es la disciplina del cero falso un nivel más arriba: **aplicada a la conclusión, no al dato.**
  - **Falta partir los 60 por unidad, y por qué cambia todo:** de los 15 silencios más largos, al
    menos 12 **no son puestos de sucursal** (`coordinador-operaciones-zona`, `surtidor-zona`,
    `vendedor-rd`, `vendedor-mayoreo`, `aux-reparto`, `analista-ordenes-entrada`,
    `servicios-al-personal`, `auxiliar-auditoria-prevencion`). Son **dos problemas con respuestas
    opuestas**:
    - **Plaza de sucursal en silencio = adopción.** Se resuelve hablando con su Gerente.
    - **Plaza de CEDIS, ventas, zona o administrativa en silencio = les emitimos obligaciones
      sin haberles construido nada.** No tienen ámbito, ni pantalla, ni unidad en ningún
      tablero. «SISTEMAS al 3%» con 3 puestos en todo el organigrama es eso, no desidia.
  - **El hallazgo 5 estorba justo en el primer diagnóstico que importa:** ese cruce puesto→unidad
    **no se puede escribir en SQL**, porque la unidad no está en la base — vive en
    `organigrama.catalogo.ts` (89 puestos: cedis 15, sucursal 14, administrativa 14, ventas 11,
    comercial-marketing 11, operaciones-zona 9, staff-zona 5, capital-humano 5, sistemas 3, zona
    1, dirección 1). Por eso el split va como **script de Node que LEA el catálogo** y cruce
    contra la base. **Copiar la lista a un `VALUES` sería exactamente la lista local que el
    modelo prohíbe.**
  - **Ambigüedad de datos que salió de paso:** el catálogo de ubicaciones tiene `Canindo`
    (`Block P Bodega 6` — una bodega) **y** una entrada aparte `CEDIS` con dirección vacía. El
    concepto está duplicado. 9 de los 15 silencios más largos son de Canindo, así que resolver
    cuál es cuál cambia la lectura de ese grupo.
  - **Regla que esto deja:** mientras no exista la partición, **ningún porcentaje de esos
    tableros sube a Dirección.** El riesgo de hoy es que alguien vea «Padre Hidalgo 2%» y hable
    con una persona por un número que mide emisiones al vacío. El invariante «un cumplimiento sin
    fidelidad no se reporta» dejó de ser teoría.
  - **Y lo que más pesa de mi lado:** tres de las cuatro asignaciones de puesto que hice el
    30/ago —`JUAN MANUEL ESPINOZA ALACARAZ`, `JOSE DE JESUS ZAVALA VILLALOBOS`,
    `MANUEL MEDIAN ESPINOZA`— son a fichas que **NUNCA han entrado**. Correctas técnicamente y
    casi vacías operativamente: pasé un día persiguiendo typos cuando el problema era que nadie
    está abriendo la app.
- **31/ago/2026 — el caso Yadira se reencuadra: no es higiene de datos, es adopción.**
  - **El bug real está en `api/login.js:45`**, no en `login-usuario.js:25`. Mismo patrón
    (`where lower(usuario) = $1 or lower(correo) = $1 limit 1`, sin `order by`) pero **ése es el
    que autentica y emite el JWT**; el otro solo resuelve usuario→correo para el camino viejo de
    Firebase. La fila que Postgres devuelva primero es la ficha en la que la persona **se
    convierte**, y contra el hash de esa fila se valida su contraseña. El arreglo cubre los dos.
  - **Se arregla con determinismo, no con negativa.** La tentación es aplicar "no adivinar" y
    devolver error ante la ambigüedad, pero eso deja fuera de la app a una Encargada que
    necesita trabajar hoy: **la regla de no adivinar es para escribir datos, no para dejar
    entrar a alguien.** Un `order by` estable (activo, luego con puesto, luego latido más
    reciente, luego id) más un `console.error` que nombre la colisión.
  - **LO QUE NO VI EN MI PROPIA SALIDA: los dos latidos son de JUNIO** (30/jun y 24/jun) y hoy
    es 31/ago. **Nadie ha entrado por ninguna de las dos en más de dos meses.** Eso cambia el
    caso entero: la Encargada de Morelia Abastos no está usando la app, y desde el 28/ago el
    robot le emite ~10 puntos diarios a una cuenta que nadie abre. Su cumplimiento no está
    hundido por un duplicado — está hundido porque ahí nadie opera el sistema. Es
    `no_ejecutado` / `no_asignado`, una falla de supervisión, y **es exactamente el hueco que
    predice el modelo: hoy la ausencia y el incumplimiento se ven idénticos.**
  - **Corrección de marco, verificada:** la ficha bien escrita **no nació de mi 039**. Su latido
    del 24/jun lo prueba —un latido lo escribe `app.ts:178` en una sesión, que requiere que la
    fila existiera— y se comprobó que 039 hizo `coalesce(u.datos,'{}') || jsonb_build_object(…)`
    sobre el `datos` propio de cada ficha, sin copiar ningún blob, y que **ninguna** migración
    038–046 inserta usuarios. Mi migración volvió **caro** el duplicado; no lo creó.
  - **Cómo se dice ante Dirección, con precisión:** NO es que "dos personas puedan entrar a la
    misma cuenta" —eso sería peor y no está probado—. Es que **una persona entra a dos cuentas
    distintas y el sistema la cuenta como dos.** Exacto, y más fuerte que el marcador de seis.
- **31/ago/2026 — 049 dio la causa raíz, y NO es de Yadira.** El caso no se puede decidir con
  datos, y por debajo apareció algo peor.
  - **Las dos fichas comparten el mismo `usuario`: `yadira.campero`.** Y `api/login-usuario.js`
    línea 25 resuelve con `where lower(usuario) = $1 or lower(correo) = $1 **limit 1**`, **sin
    `order by`**. Con dos filas que comparten el usuario, Postgres devuelve la que encuentre
    primero y eso puede cambiar entre planes de consulta: **la misma persona con las mismas
    credenciales aterriza en una ficha u otra según el día.** Eso explica que las DOS tengan
    latido (30/jun y 24/jun) — no había fantasma.
  - **El caso queda sin decidir, por regla (§8.5).** Las tres señales fallan: los dos únicos
    checklists trabajados traen `uid=(sin uid)`, son del 19/may, `created_by = Luis Francisco
    Lopez` y sin enviar; ambas fichas tienen latido; y ninguna tiene token de dispositivo
    (`dispositivos=0` en las dos). Se le pregunta a ella o a su Gerente.
  - **Esto reordena la prioridad.** Un `usuario` duplicado no es un problema de reporte: es de
    identidad en el login. Mientras exista, cualquier corrección sobre una de las dos fichas
    puede aplicarse a la cuenta por la que ella NO entró ese día. **Medir cuántos `usuario`
    están duplicados va antes de la 050.**
  - **Y sube al guardián v2:** el colapso por `usuario` es una señal **más dura** que el
    parecido de nombres — es una colisión exacta en la llave de acceso, no un parecido.
- **31/ago/2026 — 049 y el apretón del KPI.**
  - **049, solo lee.** Las dos consultas de David para saber **por cuál ficha entra** Yadira.
    "Quién trabajó" no es "por dónde entra": la señal definitiva es el `assigned_uid` de los
    checklists trabajados, respaldada por `ultimoLatido` (lo escribe `app.ts:178`, en
    milisegundos) y por los tokens de dispositivo. Si las tres se contradicen, se le pregunta a
    ella — no se decide en SQL.
  - **`_excluidoKpi` ahora exige motivo.** Antes bastaba la bandera y `motivoExclusion`
    rellenaba con `'sin motivo registrado'`: justo la exclusión que en tres meses nadie puede
    explicar. Se agregó `exclusionDocumentada()` —bandera **y** motivo— y `exclusionSinMotivo()`
    para poder listar las puestas a medias en vez de perderlas. Una bandera incompleta deja el
    checklist **contando**, que es el lado seguro del error.
  - **Lista de compras de la Fase 3 (los 16 pares del guardián v1).** No son ruido: son plazas
    que el sistema no puede distinguir. Cinco anaquelistas en Canindo aparecen "repetidos"
    porque no existe el ámbito — es el problema del pasillo entrando por otra puerta.
    Canindo: anaquelista×5, vendedor-rd×4, surtidor-zona×3, cajero×3 · 8 Esquinas:
    anaquelista×5 · Padre Hidalgo: anaquelista×5, cajero×3, surtidor-ventas×2 · La Piedad
    Abastos: cajero×2, anaquelista×2 · Yurécuaro: anaquelista×2 · MKT: aux-mercadotecnia×2 ·
    RH: servicios-al-personal×2 · COMPRAS: analista-ordenes-entrada×2.
  - **Artefactos de captura, NO duplicados** (regla: arreglar la comparación, nunca el dato):
    `LUISA RENATAHERNANDEZ GARCIA` sin espacio, `VICTOR  MANUEL ZALAPA` con dos, espacios
    finales en tres nombres, y `Maria selene olivarez gonzales` donde la nómina dice *OLIVARES*.
    `RENATAHERNANDEZ` no va a tokenizar bien nunca.
  - **Riesgo abierto: emisiones con fecha futura.** Hay 15 checklists fechados 01/sep con 29
    puntos, creados hoy. `home.ts` está cubierto porque compara `c.date === hoyISO()` —igualdad
    exacta, no rango— y `ranking`, `productividad`, `calendario` y `cierre-mensual` mandan
    `hasta`. **Expuestas:** `checkstore.ts:270` acepta por `(ahora - creación) <= 24h`, así que
    un checklist de mañana creado hoy entra; y `estadisticas.ts` agrega en 249 y 278 **sin cota
    de fecha** sobre un `?desde=` sin `hasta`. Es la clase de error que arruinaría el cierre
    diario de la Fase 6.
- **31/ago/2026 — pasos 047 y 048.** Dos migraciones y el mecanismo de exclusión del KPI.
  - **047, solo lee.** (a) La consulta de David: puntos con `permiteFotos` **por fecha**, junto
    a `checklists` y `puntos` — la fila de hoy es la que dice si el arreglo del robot está
    desplegado, porque ese arreglo tiene dos mitades independientes (código y dato) y la 046
    solo cubrió la segunda. (b) **Guardián de duplicados:** pares (sucursal, puesto) con más de
    una ficha activa, marcando `[MANDO]` como pista. Es una detección, no un módulo: cabe en el
    congelamiento.
  - **048, Yadira Campero.** Reporta y **se abstiene por diseño**: con la captura, las dos
    fichas tenían puntos asignados (76 y 230), así que por la regla de "no resolver un empate"
    no toca nada. El reporte se amplió para que la decisión sea posible: además del conteo,
    imprime **puntos trabajados**, **checklists entregados** y **rango de fechas** de cada
    ficha. Una ficha con 0 trabajados y solo fechas de hoy es el robot repartiendo, no una
    persona usando la app. La reversa está escrita en la cabecera del archivo.
  - **`medicion.util.ts` ahora honra `_excluidoKpi`.** Es el mecanismo que faltaba: desactivar
    una ficha detiene la sangría pero deja sus puntos en el denominador para siempre. Ahora se
    marca con motivo, autor y evento, y las **7 pantallas** que consumen esa regla lo respetan
    solas. Queda inerte hasta que algo se marque.
  - **Lo aprendido, dos veces sobre mí mismo:** un `raise notice` con `%%` (que es un `%`
    literal) dejaba 4 marcadores para 5 argumentos y habría reventado la migración. Y el auditor
    que escribí para detectarlo dio un **falso positivo** porque contaba comas sin respetar
    paréntesis: `coalesce(r.desde,'-')` lleva una dentro. La §8.11 aplica también a las
    herramientas de verificación.
- **31/ago/2026 — cambio de regla: el despliegue se delega.** David pidió que las
  actualizaciones se suban solas (§8.9 reescrita). Estado al momento del cambio: nada sin
  commitear, `HEAD == origin/main`, y **cero** archivos de app tocados desde `565ea1f` (el
  último `railway up`), así que producción estaba al día. La condición para desplegar queda
  explícita —haber tocado `src/`, `api/`, `server.js`, `package.json`, `Dockerfile` o
  `angular.json`— para no repetir los nueve despliegues del día, que atascaron la navegación de
  los clientes por sí solos.
- **31/ago/2026 — paso 0.2, pendiente de correr.** `scripts/diagnostico-divergencia.js` listo.
  Mide la dirección que importa: **documentos que existen solo en Firestore**, porque son los
  que la app no muestra (lee Postgres). Lo inverso —filas que Postgres tiene y Firestore no— es
  el histórico de los cortes y es esperado: `corte.js` borraba todo `enviado == true` sin filtro
  de fecha. Corre con `FIREBASE_SERVICE_ACCOUNT` y la `DATABASE_URL` **pública** de Railway.

---

## Documentos de referencia

Los cinco documentos completos de la revisión (privados de la cuenta de David):

1. **Radiografía de MDTask** — diagnóstico estructural del código, 8 hallazgos con evidencia.
2. **Operación Comprobable** — la plaza, la pirámide de 5 niveles, las 5 anclas.
3. **Estructura Transversal** — el eje de unidades, las 5 causas, el tablero por nivel.
4. **Sidebar por Nivel** — los 4 menús y el destino de cada ruta actual.
5. **Ruta de Ejecución** — el plan detallado de 9 fases y 47 pasos con criterios de aceptación.
