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
| 3 | La estructura como dato (unidad, sucursal, ámbito, puesto, plaza, cobertura) | 4 | 1 | 🔄 **3.1a ✅ · 3.1b ✅ · COBERTURA ✅ (13/sep: plantilla → plazas numeradas → pase de lista, todo desplegado; nadie ha capturado una plantilla todavía) · falta el ACCESO POR PLAZA (el login), 3.1c (ámbito), 3.2 (el robot emite a la plaza), 3.3 (los 119 usos de `assigned`)** |
| 4 | Navegación (4.1 se puede hacer YA, sin dependencias) | 1.5 | — / 3 | 🔄 **4.1 ✅ · 4.1b: 2a–2d ✅ (15→12 entradas) · Tareas unidas ✅ 14/sep (12→11: las dos entradas de tareas son una) · falta el Paso 3 para llegar a 7 · 4.3 espera Fase 3 · el Dashboard ya se gatea por jefatura (3/sep) · el ÁRBOL de Tareas del Manual ya se recorta por puesto (11/sep): cada nivel arranca en su propia raíz** |
| 5 | Verificación con muestra + hallazgos + causas | 2 | 3 | ⬜ |
| 6 | Tablero por nivel + cierre diario + roll-up | 2 | 5 | ⬜ **el tablero de DIRECCIÓN ya existe y está gateado (2–3/sep); el de nivel —«Mi zona», «Mi sucursal»— no, y por eso una Encargada ve un bloque que le nombra el hueco** |
| 7 | La norma como dato (manual y organigrama fuera del código) | 3 | 3 | 🔄 **7.1a ✅ (15/sep, desplegada): `mdtask_tareas_puesto` + la captura en Manual por Puesto. La tabla nace VACÍA y el emisor NO la lee todavía — que lo capturado se entregue es 7.1b, y ése sí mueve el denominador de 104 personas** |
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
| Foto obligatoria en los 377 puntos, incluidas 62+ declaraciones donde no hay qué fotografiar (orden de Dirección, 3/sep) | Regla 1 de `evidencia-manual.ts` | 5 — verificación por muestra; la declaración se comprueba firmando, no fotografiando. **Abonados 2 el 21/sep**: los puntos de ausencia y de pendientes del turno piden lo ESCRITO, declarado uno por uno (`escrito` en `evidencia-manual.ts`), nunca a bulto |
| Migraciones 038, 039, 041, 042, 043 con nombres de personas | Hallazgo 8 | 9.4 · **no se editan** (ya aplicadas) |
| **Un 5.º poll dentro del servidor web**: el emisor del manual (14/sep, noche) | Hallazgo 6 · Fase 9.1 | 9.1 — sale junto con los otros cuatro. Se contrajo a sabiendas: el reloj estaba **peor** que dentro del web, estaba dentro de un navegador, así que moverlo aquí es un peldaño hacia arriba, no hacia abajo. Amarra la app a **una réplica**, que ya era el caso (paso 0.4) |
| **Taxonomía provisional de motivos** sin prueba (`motivo-sin-prueba.util.ts`, 18/sep) | §4 · las cinco causas | 5 — se contrajo a sabiendas para no perder el dato: hoy todo punto sin foto es `no_ejecutado` para todos por igual, y la diferencia entre «no había qué fotografiar» y «nadie lo hizo» **no se puede reconstruir después**. Se guarda el **código que eligió la persona**, no solo la causa deducida, para que Fase 5 reescriba el mapa sin volver a preguntarle a nadie. `no_aplica` queda **sin causa** a propósito: forzarlo a `no_ejecutado` le colgaría una falta a quien hizo lo correcto (§8.5) |

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


### 21/sep/2026 (tarde) — DOS NORMAS NUEVAS: el Auxiliar deja de pedir prestada la de su jefa

Instrucciones de David, en el mismo turno: los ocho puntos que le propuse para el Auxiliar de
Encargado *«solo agrégalas a los puestos de aux de encargada»*, y para el Surtidor *«cámbiala a
solo surtir listas de pasillos, foto por cada lista y pasillo […] cambia en donde diga tickets y
así, por listas, ya que el surtidor lo que surte son las listas de pasillos»*.

#### EL AUXILIAR: CONSERVA APERTURA Y CIERRE, Y SU OPERACIÓN ES SUYA

Por la mañana pasó a compartir el manual de la Encargada, y esa operación lleva **puntos de
mando**: «Ausencias cubiertas…» decide **quién** cubre, y el Auxiliar **es** quien cubre (decisión
de David, 19/sep: *cubre, no manda*). Elegido con las tres variantes y su precio enfrente:

    Apertura ......... 7 pts  compartida con la Encargada
    Cierre ........... 8 pts  compartida
    Operacion PROPIA . 8 pts  <- NUEVA, y ya no recibe la de ella (5)
    ------------------------  20 -> 23 puntos/dia

**Y si solo se «agregaba», quedaba un duplicado.** Ella ya tiene «Pendientes del turno anterior»
como listado y el punto 1 del Auxiliar es el mismo hecho: dos listados por el mismo trabajo, que
es justo lo que se quitó esta mañana al sacar ese punto de la apertura.

#### EL MECANISMO ES `soloPuestos` POR TAREA, Y LA ALTERNATIVA ROMPÍA EL SELLO EN SILENCIO

Lo natural era darle un segundo manual. **Está mal, y se ve leyendo una línea:** `manualDePuesto()`
devuelve **el primero que encuentra**, así que sus checklists se habrían sellado con el documento
equivocado —§5.4 dice que cada emisión guarda la versión con la que se juzgó— sin un solo error
visible. Con un campo por **tarea** sigue habiendo un manual por puesto y el sello no se mueve.

**El filtro vive en UNA función** (`tareasDelManualPara`), porque la pantalla de «Del manual»
recorre `puestoIds × tareas` a mano: con el filtro copiado allá, ofrecería asignar una tarea que
el robot no entrega, y quien la asignara se quedaría creyendo que hizo algo.

#### SUS 8 PUNTOS NO SE SELLAN CON EL DOCUMENTO DE ELLA, Y EL TEXTO ES FEO A PROPÓSITO

No salen de ese manual: se derivaron del Cajero, el Anaquelista y de «cubre, no manda». Sellarlos
con «Encargada de Sucursal PH» afirmaría que están en un papel donde no están. Llevan
`selloPropio`: **«Operación del Auxiliar de Encargado — derivado, pendiente de manual propio»,
versión 0.1**. Se lee como lo que es hasta que Capital Humano escriba el suyo. NEG-C lo quita y la
prueba nombra el documento exacto que saldría.

#### EL SURTIDOR: EL VOCABULARIO LO CORRIGIÓ DAVID, Y TRES PUNTOS SE CAYERON SOLOS

Mi propuesta venía del **Checador de CEDIS** y hablaba de pedidos, tickets, carretas y tarimas.
En un pasillo eso no significa nada: «carro o carreta separada por pedido», «etiquetado con su
destino visible» y «lo que Checado me devolvió» se fueron. Hay una prueba que lo fija **por
ausencia de esas cinco palabras**, no por la presencia de las buenas.

**Y el cambio de vocabulario movió el PUESTO.** «Listas de pasillo» es lenguaje de piso, no de la
cadena de reparto — y el dato lo confirma: de las 13 filas de surtidor en la nómina, **12 se
llaman «Surtidor» a secas y solo una «Surtidor De Pasillo»**, que es justo la de sucursal. Se
midió antes de escribir:

    surtidor-zona ...... 4 (base) · 10 (nomina)  centros Tlmkt y Rutas — otra cadena
    surtidor-ventas .... 2 · 2                   la unidad `ventas` ENTERA no tiene manual
    surtidor-sucursal .. 1 · 1                   <- este, y es el unico «De Pasillo»
    surtidor-cedis ..... 0 · 0                   nadie lo ocupa

**A los otros tres no se les da**, y por motivos distintos: los de zona están en otra cadena, para
los de ventas no hay de dónde derivar —11 puestos sin un solo manual— y el de CEDIS no tiene
gente. Decisión de David con las cifras enfrente.

**Se escribe para UNA persona, y se hace igual porque la norma es de la PLAZA, no de quien la
ocupa** (§4): el día que entren tres surtidores ya está escrita, y el día que esa persona se vaya
no se va con ella.

**Límite honesto del punto 1**, escrito en el código para que no decepcione: la app pide N fotos
con su hora de captura, pero **no puede exigir que sean una por pasillo** —no sabe cuántos hay ni
cuántas listas recibió esa persona—. Lo verifica la Encargada mirándolas. El día que exista el
**ámbito** como dato, se vuelve exigible solo: es Fase 3, y este punto es su caso de uso.

#### LO QUE EL ARNÉS TENÍA QUE MEDIR Y NO EXISTÍA ANTES

La operación del Auxiliar lleva **dos listados y dos cuadros en el MISMO checklist**. Si
compartieran estado —un `ngModel` mal atado, un `trackBy` que colapse índices— escribir una vez
cerraría dos puntos: **cumplimiento regalado sin que nadie escribiera**. Dos filas nuevas:

    escenario                                            escritos area lista rengl archivo paloma done vacio
    AUXILIAR: abro su operacion (2 listados + 2 cuadros)        4    2     2     0       4      0    0     4
    AUXILIAR: lleno UNO — el otro NO debe cerrarse              4    2     2     1       4      0    1     3

**MI PRIMER CONTROL NEGATIVO DE ESO FUE UN NO-OP Y DIO VERDE.** Hice que `renglonesDe` devolviera
un arreglo compartido… y `armarChecklist` ya inicializa `listado: []`, así que esa línea **no
corre nunca**. La tabla salió idéntica y estuve a un paso de leerla como «la independencia está
probada». Rehecho para cruzar de verdad —agregar un renglón lo empuja a todos los listados— rompe
**exactamente 1** aserción y la nombra: *«pulsé un botón de agregar y aparecieron 2 renglones»*.
Es la regla del 31/ago cobrada otra vez: **un control negativo que no cambia nada prueba tanto
como un cero sin denominador**, y encima suena convincente.

#### UN ARNÉS AJENO CAZÓ QUE SU PROPIA SELECCIÓN SE HABÍA VUELTO AMBIGUA

`prueba-catalogo-manual` salió en rojo diciendo que el `_puestoId` era `auxiliar-encargado` y
debía ser `encargado-sucursal`. **No era un defecto del producto.** Desde esta mañana un manual
sirve a dos puestos, así que la pantalla lista la **misma tarea en dos grupos**, y su `porTexto`
tomaba el primero —por orden alfabético, el Auxiliar—. El arnés estaba **pulsando un grupo
distinto del que afirmaba medir**.

**No se aflojó: se hizo más preciso.** Ahora selecciona dentro del grupo del puesto que dice
medir, y cuenta en cuántos aparece la tarea, para que el día que sean tres no vuelva a leerse como
un fallo del producto.

#### DESPLEGADO, Y EL LOG LO VERIFICA SOLO

    marcadores .. auxiliar-encargado.operacion 0 -> 2 · surtidor-sucursal.operacion 0 -> 2
                  44 controles en pie · 67 archivos · 4.52 MB · 0 fallos de lectura
    espera ...... 7 vueltas, anclada al rotulo `status:` y a la LINEA COMPLETA
    pruebas ..... 427 unitarias (415 -> 427) · 4 controles negativos · arnes DOM 7/16

**La verificación independiente es el censo del emisor**, que no se escribió para esto:

    «Surtidor de Sucursal» DESAPARECIO de la lista de sin manual
    «Surtidor de Zona» (4) y «Surtidor de Ventas» (2) SIGUEN ahi  <- no se les dio
    sin tareas hoy ... 72 -> 71   (exactamente una persona)
    creadas .......... 11 = 10 auxiliares x 1 tarea nueva + 1 surtidor x 1

Ese **11 cuadra exactamente**, y es lo que hace que el despliegue no dependa solo de los
marcadores del bundle.

#### LO QUE ESTO NO HACE

- **HOY los auxiliares tienen las DOS operaciones.** La de la Encargada se les emitió esta mañana,
  antes del cambio, y **no se borra** (§5.5). Mañana a las 00:00 solo sale la suya.
- **La pantalla «Del manual» lista la apertura y el cierre bajo DOS puestos.** Ya pasaba con el
  Checador; ahora también con el Auxiliar. No es un defecto de hoy y no se tocó: la elección
  determina el sello, así que tiene sentido — pero se ve como una tarea repetida.
- **Nadie ha entrado con una cuenta real.** Los 7 escenarios son sesiones sintéticas en Chrome
  headless.
- **Cero migraciones.** El manual sigue siendo código (hallazgo 5): cada corrección de norma
  cuesta un despliegue, y eso es 7.1b.


### 21/sep/2026 — LA OPERACIÓN DEL TURNO SE REESCRIBE, y dos puntos dejan de pedir foto

Instrucción de David sobre «Operación de sucursal del turno»: tres puntos se quitan, tres
cambian de texto, y al de ausencias *«en lugar de foto, un cuadro de texto en el cual diga,
por qué la ausencia, de quién, quién lo sustituyó, puesto y lugar»*. Más, en el mismo turno,
que «Pendientes del turno anterior revisados» salga de la **apertura** y viva en operación
**«como un apartado de listado»**. Y la frase que gobernó el diseño: *«cuando en comentarios
te manden una justificación debes tomarlos como las tareas en parte del porcentaje»*.

#### LA TAREA, DE 7 PUNTOS A 5

    1  Pendientes del turno anterior          LISTADO   <- venia de la APERTURA
    2  Disponibilidad de mercancia en piso    fotos
    3  Objetivo de venta del dia              fotos
    4  Revision de retiros durante el turno   fotos
    5  Ausencias cubiertas sin dejar Caja,    CUADRO DE TEXTO
       Recepcion, Piso ni Bodega desatendidos

Se retiran «Seguridad, acceso y continuidad», «Descarga, acomodo y surtido» y «Caducidades,
tareas programadas, limpieza y cierre documental». **A la Encargada le baja el denominador de
esa tarea de 7 a 5**, así que su porcentaje cambia de base: no es que se hayan perdido tareas.
Y el punto mudado **se quita de la apertura**: estar en las dos sería cobrar dos veces el mismo
hecho, que es inflar el denominador de quien lo cumple.

#### LA DECISIÓN QUE MÁS PESÓ NO ES NINGUNA DE ESAS: ES DE DÓNDE CUELGA LA REGLA

`tieneEvidencia` se aplica **al leer**, así que una rama mal puesta no rompe nada visible:
reescribe en silencio el cumplimiento de meses pasados. Lo primero que iba a hacer era colgar
la evidencia escrita de `requiereComentario`, que ya existía. **Está mal, y se vio midiendo:**
esa bandera la traen **28 puntos que ADEMÁS piden foto** y que llevan meses emitidos así. Un
punto de agosto cerrado con su foto habría pasado a exigir un texto que nadie escribió ese día.

Por eso cuelga de `evidenciaEscrita`, un campo **nuevo, que no existe en un solo documento
emitido antes de hoy**. Para todo el histórico la condición es falsa y se sigue leyendo
exactamente igual que ayer. **No es una afirmación: NEG-4 hace justo ese error en una línea y
rompe exactamente 1 prueba** — la que lo fija. Sin ese control, «el histórico no se mueve»
habría sido confianza falsa (§8.11 c).

#### Y NO REABRE LA FASE 2.1, aunque suene igual

La instrucción de David —que una justificación cuente— es literalmente lo que la Fase 2.1
derogó, y la diferencia está en **el campo**:

    notaEmpleado ...... es del CHECKLIST: UNA frase que hablaria por los 5 puntos,
                        incluidos los que nadie justifico  -> eso sigue derogado
    evidenciaEscrita .. va PUNTO POR PUNTO y solo donde la NORMA lo declara,
                        porque ahi el texto no TAPA la falta de prueba: ES la prueba

Una ausencia cubierta no tiene objeto que fotografiar. Es la **regla 1 de
`evidencia-manual.ts`** —la que Dirección aceptó como riesgo el 3/sep— cobrada en 2 de los 377
puntos. Hay una guardia que cuenta cuántos se declararon: **son 2**, y si alguien declara a
bulto lo dice antes de que 377 dejen de pedir foto sin que nadie lo haya decidido.

#### EL BOT TENÍA UNA PUERTA TRASERA, Y NO SE VENÍA A BUSCAR

`api/asistente-chat.js:2183` reparte: *«lo que no pide foto se cierra ya»*. Un punto de
evidencia escrita **no pide foto**, así que un «ya hice la 5» por WhatsApp le habría puesto
`checked = true` a la ausencia **sin una sola letra escrita** — y el bot habría contestado
«cerrada» mientras el tablero la sigue contando como no hecha. **El mismo punto contado
distinto según quién pregunte, que es exactamente la divergencia que la Fase 2.1 cerró**,
reintroducida por la puerta de al lado.

Se tapa **diciéndolo**: «se cierra escribiendo, no con una foto ni con un "ya la hice"». Un
rechazo mudo dejaría a la persona mandando imágenes a un punto que no las acepta. Y el espejo
de `itemHecho` se movió con la regla, que es lo que impide que los dos vuelvan a discrepar.

#### EL AUXILIAR DE ENCARGADO PASA DE CERO TAREAS A TRES

Instrucción de David: *«ya que no existe el turno de Aux de encargada(o) créalo y agrégale las
mismas tareas que tienen el puesto de encargada de sucursal»*. **Comparte el manual, no una
copia**: dos documentos con los mismos puntos serían dos normas libres de discrepar, y la que
se quedara atrás juzgaría a una de las dos poblaciones con una regla vieja. Es el patrón que ya
usa el Checador.

**Medido en producción después de desplegar, que es la verificación que vale:** el censo del
emisor dejó de nombrarlo. Era **el primero de la lista de puestos sin manual, con 11 personas**
(15/sep); hoy aparece **0 veces**, y la vuelta creó **30 tareas = 10 auxiliares × 3**. Su
denominador nace hoy; no existía antes.

#### LO QUE NO SE PUDO HACER, Y NO SE INVENTÓ

«Objetivo de venta del día» **depende del turno**, y David lo dijo. **No se puede expresar
todavía**: la tarea es UNA diaria y el turno no existe como dato (Fase 3). Queda anotado en el
catálogo y no rellenado por parecido (§8.5) — hoy le sale igual a la Encargada y al Auxiliar,
todos los días.

#### VERIFICADO

    unitarias ... 415 (394 -> 415, 21 nuevas en `evidencia-escrita.spec.ts`)
    DOM ......... `prueba-evidencia-escrita.js`: 5 escenarios, 11 aserciones
    vecinos ..... dom-evidencia · envio-anaquelista · tareas-unidas · arbol-organigrama, en verde

**El checklist del arnés sale de la regla COMPILADA** (`dist/manual`), llamando a
`armarChecklist`, no de un fixture tecleado ahí. Un fixture con una forma que el sistema no
produce no solo deja de encontrar defectos: **fabrica defectos que no existen**, y eso ya
cambió la prioridad de un plan una vez (19/sep).

| escenario | escritos | área | lista | rengl | archivo | paloma | done |
|---|---|---|---|---|---|---|---|
| abro la tarea | 2 | 1 | 1 | 0 | 3 | 0 | **0** |
| escribo el cuadro | 2 | 1 | 1 | 0 | 3 | 0 | **1** |
| agrego un pendiente y lo escribo | 2 | 1 | 1 | 1 | 3 | 0 | **1** |
| lleno los dos | 2 | 1 | 1 | 1 | 3 | 0 | **2** |
| CONTRASTE: la apertura | 0 | 0 | 0 | 0 | **7** | 0 | 0 |

**La columna `paloma` es 0 en las cinco filas, y ese cero no valía solo.** Lo hace valer el
control negativo: devuelto el `!pideEvidencia` viejo, sube a **2** y rompe **exactamente 1**
aserción, la que impide que el punto tenga una segunda forma de cerrarse sin prueba. Los cuatro
controles, una línea cada uno con su `diff` comprobado:

| | qué se rompió | qué pasó |
|---|---|---|
| NEG-1 | lo escrito deja de contar | 2 rotas: `Expected 'no_ejecutado' to be 'hecho'` |
| NEG-2 | la cámara vuelve a los dos puntos | 4 rotas, incluido el sello de tiempo |
| NEG-3 | el Aux se queda sin manual | 4 rotas: `Expected 0 to be 3` |
| NEG-4 | la regla cuelga de `requiereComentario` | **exactamente 1**: la del histórico |
| NEG-DOM | vuelve `!pideEvidencia` | 1, y `paloma` **0 → 2** |

**Las 2 pruebas de `plantilla.util.spec.ts` que fijaban «el Aux no tiene manual» estaban en rojo
al aplicar el cambio.** Son su control positivo, escritas antes y por otro motivo, y se
corrigen a mano en este mismo commit en vez de aflojarlas.

#### DESPLEGADO

    marcadores .. cl-escrito 0 -> 29 · evidenciaEscrita 0 -> 10 · 42 controles en pie
                  67 archivos · 4.51 MB · 0 fallos de lectura
    espera ...... 12 vueltas, anclada al rotulo `status:` y a la LINEA COMPLETA
    log ......... arranca limpio, migraciones al dia, el emisor carga su regla
                  (ventana de 14 lineas: una ausencia ahi no concluye sola)

El marcador se eligió **sin vocales acentuadas a propósito**: el bundle las escapa y un ancla
con acento no pega — sería un no-op, y un no-op da verde (14/sep). Validado en las dos
direcciones antes de subir: presente en `dist/`, **0 en producción**.

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **HOY CONVIVEN LAS DOS VERSIONES, y es correcto.** Los checklists de las Encargadas se
  emitieron a las 00:00 con los 7 puntos viejos y **no se reescriben** (`on conflict do
  nothing`, y la llave de idempotencia no cambió): lo ya entregado no se toca (§5.5). Los 5
  puntos nuevos empiezan mañana a las 00:00. Los Auxiliares sí los tienen ya, porque sus
  tareas nacieron esta mañana.
- **El bot no puede capturar lo escrito**, solo lo dice. Cerrar esos dos puntos desde WhatsApp
  necesitaría un flujo de texto que hoy no existe; se rechaza con una frase que manda a la app.
- **El modal de «motivo sin prueba» sigue hablando de fotos** cuando el punto que falta es de
  texto. No rompe nada —el motivo se guarda igual— pero su redacción es de la otra familia.
- **Nadie ha entrado con una cuenta real.** Los 5 escenarios son sesiones sintéticas en Chrome
  headless: prueban qué hay delante de quien llena el checklist, no que se **vea** bien en un
  iPhone. Y Chrome no es Safari (13/sep).
- **Cero migraciones.** El manual sigue siendo código (hallazgo 5): cada corrección de norma
  sigue costando un despliegue. Eso es Fase 7.1b.


### 20/sep/2026 (noche) — «ENVIADAS» PEDÍA TREINTA DÍAS Y NO RECORTABA NINGUNO

Reporte de David: *«en enviadas del equipo aparecen las viejas y tienen que ser solo las
del día»*.

#### LA CAUSA ES UNA ASIMETRÍA ENTRE LAS DOS BANDEJAS

    Pendientes .. `/api/checklists?desde=hoy`            -> hoy en adelante
    Enviadas .... `/api/checklists?desde=hace30`  Y NADA -> un mes entero

`cargarEnviadas()` pedía 30 días y **después no filtraba la fecha**. Las dos bandejas
vivían en escalas distintas, y eso es literalmente lo que se veía en pantalla.

#### POR QUÉ SE FILTRA POR `date` Y NO POR CUÁNDO SE ENVIÓ

**Porque no existe.** La tabla tiene `enviado` (booleano) y `timestamp_creacion`, pero
**ninguna columna con la hora del envío** (`009_checklists.sql`). O sea que «se envió
hoy» no se puede saber; lo único que hay es el día al que pertenece la tarea, que además
es el mismo criterio que ya usa «Pendientes». Dato que falta, anotado y no adivinado.

**Consecuencia, dicha para que no sorprenda:** un checklist de AYER entregado esta mañana
**no sale** en esta bandeja. Es la misma regla que «Pendientes» ya tenía —tampoco trae
días pasados, salvo TEC— así que esto **alinea** las dos en vez de abrir un caso nuevo.

Se acota **por los dos lados**. Con solo `desde`, un checklist fechado mañana y marcado
enviado seguiría saliendo — y los hay: el 31/ago se midieron 15 con fecha 01/sep creados
el día anterior.

#### LA PROTECCIÓN ES DOBLE A PROPÓSITO, Y CADA MITAD SE VERIFICÓ SOLA

Un control negativo que no cambia nada no prueba nada, así que en vez de uno se corrieron
dos, y la pareja es lo que demuestra que la redundancia es real y no un descuido:

| | qué se rompió | qué pasó |
|---|---|---|
| NEG-A | la consulta vuelve a 30 días, la guarda de cliente intacta | **0 coladas** — la guarda sola basta |
| NEG-B | ninguna de las dos | **1 colada: «VIEJA de mi tienda»** — el defecto literal |

#### DOS COSAS QUE CAZÓ EL ARNÉS, Y LAS DOS ERAN MÍAS

1. **No había reconstruido.** La primera corrida dio la vieja colada con el código ya
   escrito. *«Después de editar, reconstruir»* (1/sep), otra vez.
2. **El servidor de la prueba devolvía siempre las siete filas**, ignorando `desde` y
   `hasta`. Así se habría probado **solo el filtro de cliente** y habría dado verde
   aunque la consulta siguiera pidiendo treinta días — o sea, la mitad del defecto
   intacta y la tabla en verde. Ahora los honra, como el endpoint real.

El fixture nuevo es de **ayer y de su propia tienda**: así solo puede quedar fuera por la
fecha. Si fuera de otra sucursal o de un área, el recorte transversal se la llevaría y el
caso no distinguiría cuál de los dos filtros actuó.

#### DESPLEGADO

    marcador .. «Sin entregas hoy»  0 -> 1 servido · 41 controles en pie
                67 archivos · 4.51 MB
    pruebas ... 394 unitarias · los arneses de bandeja en verde
    espera .... 5 vueltas

El marcador es **el texto del vacío, y hacía falta igual**: decía «no hay tareas enviadas
en los últimos 30 días», que desde hoy es **falso** — le diría a una Encargada que no se
ha entregado nada en un mes cuando puede haber decenas. Un vacío que explica mal es peor
que uno que no explica: manda a buscar un problema que no existe. Ahora dice que la
bandeja muestra el día en curso y dónde está lo demás.

#### LO QUE ESTO NO HACE

- **«Mis tareas enviadas» también queda en el día**, porque las dos bandejas salen de la
  misma carga. Es coherente, pero no se pidió explícitamente: si el historial propio debe
  conservar el mes, es un interruptor aparte.
- **No existe «entregado hoy»** mientras no haya columna de fecha de envío. Es lo que
  impide distinguir «se entregó tarde» de «no se entregó».
- **Nadie ha entrado con una cuenta real.** Cero migraciones.


### 20/sep/2026 (tarde) — EL EJE TRANSVERSAL, POR FIN EN LOS NÚMEROS: MANTENIMIENTO y SISTEMAS

Instrucción de David: *«encargadas, jefes de zona, auxiliares de encargadas y todo lo que
tenga que ver con esos puestos en el organigrama no pueden ver las tareas que tienen
asignadas el departamento de Sistemas y Mantenimiento, a menos de que su sucursal las
haya asignado; solo así pueden ver las que asignaron»*.

**Es el hallazgo del 4/sep cobrado.** Aquel día se hizo el eje transversal *en una
pantalla* y quedó escrito que los tableros seguían sumando por `store`. Esto es la otra
mitad.

#### POR QUÉ LAS VEÍAN TODAS, Y ESTABA MEDIDO DESDE HACE UNA SEMANA

El filtro de visibilidad tiene **un solo eje** —`alcanceCubre(permitidas, c.store)`— y
`store` hace **dos trabajos**: dónde ocurre el trabajo y de qué departamento es. El
detonante estaba en la bitácora del 15/sep sin que nadie lo conectara: la ficha de una
Encargada lleva `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`, y **esas dos están ahí para
que pueda levantar un ticket, no porque trabaje ahí**. Como `sucursalesPermitidas` las
devuelve igual que su tienda, el filtro le enseñaba las órdenes de las otras siete.

#### EL CAMPO YA EXISTÍA Y NO LO LEÍA NADIE

`checklist.ts:4889` guarda `mantenimiento.sucursalOrigen` desde hace meses y hasta hoy
**solo se pintaba en el detalle**. Es la «unidad servida» del §5, capturada y sin usar:
no hubo que inventar el dato, hubo que enchufarlo.

#### CUATRO PUERTAS, UNA POR FRASE DE LA INSTRUCCIÓN

    pertenece al area      -> es su trabajo
    esta asignada a ella   -> es su trabajo, aunque el area sea otra
    la creo ella           -> «las que asignaron»
    el origen es su suc.   -> «a menos de que su sucursal las haya asignado»

La segunda no es adorno: sin ella, el día que a alguien de sucursal le toque apoyar en
una orden, **la tarea le desaparecería de la lista** y nadie sabría por qué.

#### SE IDENTIFICA EN POSITIVO, Y ESA ES LA DECISIÓN DE SEGURIDAD

El error caro aquí **no es «una Encargada ve de más»: es esconderle su trabajo a quien
tiene que hacerlo.** Un técnico que deja de ver sus órdenes no las hace, y eso no se
reporta como bug — se reporta como que la app no sirve.

Así que el recorte se aplica **solo a quien se identifica positivamente** como operación
de sucursal o zona. Y esas unidades **se derivan** recorriendo `reportaA` desde
`gerencia-zona` —40 puestos, 5 unidades— en vez de escribirse a mano, que es lo que
envejece. Quien no resuelva puesto conserva lo de hoy: son **44 fichas activas**
(15/sep), y entre ellas puede haber técnicos.

#### SISTEMAS NO TIENE ORIGEN, Y SE DICE EN VEZ DE RELLENARLO

El formulario solo pide `sucursalOrigen` cuando el `store` es MANTENIMIENTO. De una
tarea de Sistemas **no se puede saber de qué tienda salió**, así que ahí solo queda «la
creé yo» — que es literalmente lo que pidió David. Queda anotado como dato que falta
(§8.5), no adivinado.

#### SE ENGANCHA EN LOS TRES FILTROS, NO EN UNO

Pendientes, enviadas **y el tablero**. Si el tablero contara las órdenes que la lista no
enseña, los dos números se contradirían en la misma pantalla — que es peor que
cualquiera de los dos por separado.

#### VERIFICADO, Y NO CONTANDO TARJETAS

**394 pruebas** unitarias (371 → 394) más `scripts/prueba-area-transversal.js` en el DOM,
que comprueba **cuáles** sobreviven y no cuántas: «hay menos tarjetas» lo pasa un filtro
que borre al azar.

    ENCARGADA  4 de 4 esperadas · 0 coladas
    TECNICO    3 de 3 esperadas · 0 coladas   (ve la de Canindo: es su trabajo)

**Control negativo**, una línea con su `diff`: apagado el recorte la Encargada pasa a 6
tarjetas y vuelven **exactamente las dos del defecto** — «MANT ajena» y «SIS ajena».

**Y mi fixture del contraste estaba mal en la primera corrida:** asigné las tres órdenes
al propio técnico, y «del equipo» es estricto desde el 14/sep, así que su bandeja salía
**vacía (0 de 3) con el filtro funcionando perfecto**. Un fixture con una forma que el
sistema no produce vuelve a fabricar un hallazgo falso — la misma lección del 19/sep, dos
días seguidos.

#### DESPLEGADO

    marcador .. recortadasPorArea  0 -> 1 servido · 40 controles en pie
                67 archivos · 4.51 MB
    espera .... 4 vueltas (`Initializing` otra vez, y la guardia lo aguanto)

Lógica pura otra vez, así que el marcador es el contador que el recorte deja en el
diagnóstico inline — **y hacía falta igual**: el recorte es **mudo**, y una Encargada que
pasa de doce órdenes a dos lo va a reportar como que se perdieron. Con esa cifra la
respuesta se da en un vistazo, sin ponerle un cartel en medio del turno por algo correcto.

#### LO QUE ESTO NO HACE

- **Nadie gana visibilidad.** Esto solo quita, que es la dirección segura.
- **No toca tickets ni tareas de equipo**, que son otras entidades. La instrucción habla
  de las tareas con `store` de esos dos departamentos.
- **Las otras áreas corporativas no se recortan** —RH, FINANZAS, COMPRAS, CONTABILIDAD,
  MKT—: David nombró dos. Extenderlo es un renglón en `AREAS_TRANSVERSALES`.
- **Nadie ha entrado con una cuenta real.** Cero migraciones.


### 20/sep/2026 — SE CIERRA `/api/coberturas`, y con eso sale un desfase de fecha de SEIS HORAS

Instrucción de David: *«haz la actualización de todo y súbelo a producción»*. Lo
pendiente y desplegable era el único endpoint que el cierre del 19/sep dejó abierto —y
estaba dicho en la cabecera de `_autorizar.js`, no escondido.

#### POR QUÉ ESTABA ABIERTO, Y QUÉ LO CERRÓ

Lo escriben **dos flujos legítimos**, así que las dos reglas obvias romperían algo vivo:

    1. el PASE DE LISTA .... una Encargada, que NO es admin
    2. el LOGIN POR PLAZA .. `login.ts:361`, CON EL TOKEN DE PLAZA, cuando la
                             persona declara quién es al entrar

Ahora cada uno tiene su camino. El de la plaza está acotado a **«hoy, en MI plaza, como
suplente»**, y cada condición tapa un abuso concreto: no puede declarar por **otra**
plaza, no puede nombrarse **titular** —que desplazaría al de verdad—, no puede firmar el
**pasado**, y no puede **cerrar** coberturas ajenas.

Importa porque **quien cubre una plaza decide a quién se le atribuye la evidencia de ese
día** (§4). Dejarlo abierto era dejar que cualquier token reescribiera esa atribución.

#### ⚠ MEDIR ANTES DE ESCRIBIR DESTAPÓ UN DEFECTO QUE HABRÍA ROTO LA GUARDIA

`login-plaza.js` calculaba «hoy» con `getTimezoneOffset()` y el comentario de al lado
decía **«hora de México»**. No lo es: el contenedor corre en UTC, ese offset vale **0** y
devuelve la fecha **UTC**. Medido sobre instantes fijos:

    09:00 MX  ->  correcto          18:30 MX  ->  devolvia MAÑANA
    17:59 MX  ->  correcto          20:00 MX  ->  devolvia MAÑANA
                                    23:59 MX  ->  devolvia MAÑANA

**Seis horas al día, justo el turno de cierre.** La plaza buscaba la cobertura de mañana,
no la encontraba, y le preguntaba «¿quién eres?» a todo el mundo **aunque la Encargada
hubiera pasado lista** — y la suplencia que registrara quedaba fechada mañana, así que la
Encargada la veía el día equivocado. Es el defecto que el emisor del manual ya había
cazado el 14/sep («el servidor habría emitido el día equivocado»), vivo en otro archivo.

**Y la guardia lo habría convertido en un 403.** Si hubiera comprobado la fecha correcta
contra un cliente que manda la equivocada, habría rechazado cada tarde la escritura
legítima — o sea, un candado nuevo que rompe el flujo que vino a proteger. La definición
vive ahora en `api/_fecha.js`, **una sola**, porque la miran el cliente que escribe y la
guardia que comprueba.

#### EL CONTROL DE LA FECHA ABORTÓ EN SU PRIMERA CORRIDA, Y TENÍA RAZÓN

Comparaba la fórmula vieja **llamándola**, y `getTimezoneOffset()` depende de la zona
**del proceso**: en esta laptop (hora de México) da el resultado correcto, así que las
dos coincidían siempre y el control **no ejercía nada**. La guardia de discriminación lo
dijo en vez de dar verde.

Corregido **emulando lo que hace en el contenedor** —offset 0, o sea la fecha UTC—, que
es el comportamiento en producción y no el de la máquina que corre la prueba. Diverge en
2 de 5 instantes. Es §8.11(b) otra vez: la guardia va sobre la entrada que de verdad se
usa, no sobre un proxy de ella.

#### EL AUXILIAR DE ENCARGADO, TU DECISIÓN, APLICADA AL MAPA

`auxiliar-encargado` pasa de `mando_sucursal` —el mismo perfil que la Encargada— a
`operativo`. **Cubre, no manda:** cuando la Encargada no está, su autoridad sale de la
**cobertura** de esa plaza ese día, con fecha, motivo y autor.

**Cambiar esa línea no toca ninguna ficha.** Aplicarlo es correr
`scripts/ajustar-privilegios.js` contra producción, **y eso lo corres tú** (§8.6): le
quita seis banderas a los ~11 Auxiliares que contó el censo del 15/sep — dejan de ver el
Dashboard, Control, el pase de lista y la plantilla, y pasan a ver solo sus tareas. En
seco primero (`node scripts/ajustar-privilegios.js`), y con el plan enfrente `--aplicar`,
que respalda antes de escribir. El auditor lo mide: **la cubeta 2 baja de 5 a 4**.

#### LAS CIFRAS

    arnes ....... 31 afirmaciones (16 -> 31), 10 escenarios nuevos de coberturas
    unitarias ... 371 · emisor 16 · reloj 20 · menu sin una sola diferencia
    NEG-5 ....... la plaza deja de estar acotada -> 3 abusos se abren, y el
                  flujo legitimo sigue verde
    NEG-6 ....... no baja cobertura -> plaza -> EXACTAMENTE 1: el PATCH de la
                  Encargada, el que protege el trabajo de todos los dias

**Desplegado:** `● Online` en 4 esperas (apareció `Initializing` otra vez, y la guardia
lo aguantó porque afirma el estado **terminal** y no enumera los transitorios). Los 5
endpoints montados en 401. El log arranca limpio y **el emisor carga su regla**, que es
lo que prueba que `dist/manual` —con el `alcance.util.js` del que cuelga `_autorizar.js`—
viajó en la imagen. El bundle **no cambió y ese es el control**: cero archivos de `src/`,
y los 40 marcadores siguen en su sitio (66 archivos, 4.51 MB).

#### LO QUE ESTO NO PRUEBA, dicho con precisión

- **La guardia no se probó contra producción con un token real**, y no debe probarse
  así: sería escribir en producción (§8.6). Lo que está probado es el mecanismo, contra
  las reglas REALES cargadas de `dist/manual`, en 31 afirmaciones locales.
- **El arreglo de la fecha tampoco se ha visto en vivo.** Su primera prueba de verdad es
  esta tarde, después de las 18:00: si alguien entra por plaza y la app **no** le pregunta
  quién es, sirvió.
- **Siguen 9 endpoints del factory sin autorizar** (`catalogo-rutinas`,
  `asignaciones-rutinas`, `moldes-checklists`, `descansos-semanales`, `tareas-equipo`,
  `rutinas-personales`, `vehiculos`, `usuarios-tokens`, `config`). No se cierran a bulto:
  cada uno necesita saber quién escribe hoy.
- **Las 9 banderas de gestión siguen siendo equivalentes** — cualquiera da vista de toda
  la sucursal. Es el defecto grande que queda del modelo.
- **Los 11 puestos con gente debajo y sin perfil** siguen sin definir (paso D, Dirección).
- **Nadie ha entrado con una cuenta real.** Cero migraciones, ninguna ficha tocada.


### 19/sep/2026 (noche) — PASO C: el rango sale del NIVEL, y la escalada se deja sin tocar

Continuación de la revisión de permisos. Instrucción de David: *«dale a lo que
falta»*.

#### LA TABLA PRIMERO, QUE ERA LO PROMETIDO

`scripts/impacto-rango-unificado.js` (nuevo, solo lee). Y su mitad importante es que
**no evalúa fichas en blanco**: a cada puesto le da **las banderas que su perfil le
otorga** según `privilegios-por-puesto.js`. Con una ficha vacía la tabla habría dicho
que tres puestos pierden el tablero cuando dos lo pierden — o sea, habría **inventado un
impacto**. Es la lección del fixture de esta misma mañana, aplicada antes de tropezar.

    regla                                          ganan   pierden
    «su nivel manda» a secas                          2        2
    «tiene gente debajo Y su nivel manda»             0        2   <- la aplicada

Las dos que ganarían son `coordinador-cajas` y `coordinador-piso-ventas`: `coordinacion`
con **cero subordinados declarados**. Darles `/plantilla` es darles la definición de
cuántas plazas autoriza una tienda, y **ensanchar es la única dirección de verdad
peligrosa** (11/sep). **No se aplicó**, y la salida correcta no es aflojar la regla: es
declararles sus subordinados en el organigrama, que es donde esa verdad pertenece (§8.5).

#### LO QUE SE QUITÓ, Y POR QUÉ ERA LA ARISTA EQUIVOCADA

`esJefatura` daba mando con `tieneSubordinados` a secas. Tres puestos de nivel
**operativo** pasaban por jefatura porque el catálogo les cuelga un practicante:

    caja-general              operativo   1 directo (un practicante)
    servicios-al-personal     operativo   1
    reclutamiento-onboarding  operativo   1

Con eso se llevaban `/pase-lista` y `/plantilla`. Un Analista de Caja General no decide
cuántas plazas autoriza una sucursal. **Y no se cambió una fuente automática por una
lista a mano:** `NIVELES_DE_MANDO` es el MISMO corte que ya hace `alcanceDeNivel()`, con
una prueba que revienta si el catálogo gana un nivel y nadie la actualiza.

#### MI EXPECTATIVA ESTABA MAL Y EL CONTROL LA CAZÓ

Escribí «los 3 operativos con gente debajo tienen que perder el mando». **Falló: pierden
2.** Medí el porqué **antes** de tocar la expectativa —que es lo contrario de ajustarla
al artefacto—: a `servicios-al-personal` su perfil de Capital Humano le da **cinco
banderas**, así que conserva el mando por `esSupervisor`, por otra puerta y legítima,
porque esa área sí administra fichas.

El control corregido afirma el **mecanismo**, no el resultado: *ninguno de los tres puede
seguir mandando POR TENER GENTE DEBAJO* — o lo pierde, o lo conserva por bandera. La
versión anterior confundía las dos cosas.

#### VERIFICADO

    unitarias .. 371 (354 -> 371), 17 en `rango-jefatura.spec.ts`
    la red ..... las 44 fichas SIN puesto, intactas en las DOS direcciones
    menu ....... `prueba-menu-audiencias`: los 15 perfiles, las mismas rutas
    DOM ........ `prueba-guards-ruta` 48/48 · `prueba-vista-por-nivel` 9 de 9
    auditor .... la cubeta 4 pasa de 3 a 0

**El auditor se escribió AYER, antes del arreglo**, y por eso ese `3 → 0` vale: es una
medición independiente, no una aserción escrita para pasar. Y **dice en voz alta** que un
cero ahí es el arreglo funcionando, para que no se confunda con «no medí».

**Control negativo**, una línea con su `diff`: restaurada la regla vieja caen
**exactamente 4** — los dos que pierden, el que demuestra que la vía de
`servicios-al-personal` es la bandera y no el practicante, y la guardia de
discriminación. **Lo que no debía moverse siguió verde.**

#### DOS CABECERAS DEROGADAS, Y LLEVABAN SEIS DÍAS MINTIENDO

`alcance.util.ts` decía **«ESTE ARCHIVO TODAVÍA NO CAMBIA LO QUE VE NADIE […] no está
enganchado a ningún guard, menú ni consulta»**. Fue verdad el 2/sep y dejó de serlo el
13/sep, cuando `esJefatura`, `hayTableroPara` y `veUsuarios` pasaron a gobernar el menú y
cuatro guards. Nadie actualizó el texto. Y `prueba-alcance-por-nivel.js` **imprimía la
misma frase en cada corrida**, que es cómo una media verdad se vuelve doctrina (§8.11 f)
— ésta además invitaba a tocar el archivo creyéndolo inerte. Las dos se citan en vez de
borrarse, y ahora distinguen qué sigue siendo cálculo (`Amplitud`) de qué está vivo.

#### DESPLEGADO

    marcador .. sin-rango-de-mando  0 -> 1 servido · 39 controles en pie
                66 archivos · 4.51 MB
    espera .... 4 vueltas, anclada al rotulo `status:` y a la LINEA COMPLETA

Tercera vez que un cambio de lógica pura no trae cadena propia. El marcador honesto es la
línea que `estructuraGuard` escribe al rebotar, y **hacía falta igual**: este cambio es
justo el que empieza a rebotar gente de `/plantilla`, y hasta hoy rebotaba mudo. Se
distingue a propósito del mensaje de los otros cinco guards: allá falta una bandera, aquí
falta **rango**.

#### LO QUE SIGUE SIN HACERSE

- **El `auxiliar-encargado` sigue con perfil de mando.** Tu decisión —**cubre, no
  manda**— está tomada y no aplicada: cambiarlo es editar `privilegios-por-puesto.js` y
  **correr `ajustar-privilegios.js` contra producción**, que le quita seis banderas a
  ~11 personas reales. Eso lo corres tú (§8.6), no yo.
- **Los 11 puestos con gente debajo y sin perfil** siguen sin definir. Es el paso D y lo
  decide Dirección (§8.5).
- **Las 9 banderas siguen siendo equivalentes**: cualquiera da vista de toda la sucursal.
- **`/api/coberturas` y los otros 10 endpoints del factory** siguen sin autorizar.
- **Nadie ha entrado con una cuenta real.** Cero migraciones, ninguna ficha tocada.


### 19/sep/2026 (tarde) — REVISIÓN DE PERMISOS: el cable estaba abierto, y el menú gateaba solo

Instrucción de David: revisar cómo se otorgan los privilegios, «hay un mal acomodo
entre los encargados, jefes de zona, auxiliares», y reformularlo **respetando la
jerarquía del organigrama**, con el correo del dueño como única excepción.

Se midieron las **reglas** (código compilado con `tsc`, no parseado). **No los datos
de hoy**: sin `DATABASE_URL` de producción no se sabe qué banderas trae cada ficha.

#### LO QUE DESTAPÓ LA MEDICIÓN — y lo peor no era el acomodo

**1 · No hay una definición de rango, hay CUATRO**, y las dos que leen el mismo
organigrama se contradicen en **6 puestos**:

    coordinador-cajas         coordinacion  esJefatura=false  alcance=sucursal
    coordinador-piso-ventas   coordinacion  esJefatura=false  alcance=sucursal
    jefe-mantenimiento        jefatura      esJefatura=false  alcance=unidad
    caja-general              operativo     esJefatura=true   alcance=propio
    servicios-al-personal     operativo     esJefatura=true   alcance=propio
    reclutamiento-onboarding  operativo     esJefatura=true   alcance=propio

Los tres de abajo **pasan por jefatura porque tienen un practicante colgando**.
Medido en el menú real: ven `/home /pase-lista /plantilla`, contra `/tareas /agenda`
de un anaquelista. `esJefatura` lee la arista equivocada — el rango está en `nivel`,
no en `tieneSubordinados`.

**2 · El mapa de privilegios cubre 28 de 89 puestos** y contradice al catálogo en 6.
`auxiliar-encargado` (operativo, 0 subordinados) recibe **el mismo perfil que el
Encargado** — es literalmente lo que David nombró. Y **11 puestos CON gente debajo no
tienen perfil**, así que conservan lo que traiga su ficha: entre ellos
`gerencia-admin-financiera` (6 directos), `jefatura-cedis`, `coordinador-operaciones-zona`
(8). La asimetría que lo retrata: `supervisor-ventas-rd` tiene perfil y
`supervisor-ventas-vecinal` no, mismo nivel y 3 personas debajo.

**3 · Las 9 banderas de gestión son equivalentes.** Medido una por una sobre un
anaquelista: **cualquiera** de ellas da `esSupervisor=true` → `puedeFiltrarVista` →
deja de ver solo lo suyo y ve **las tareas de toda su sucursal**. Las etiquetas
prometen cosas distintas y conceden la misma. Y la ficha es un trinquete
(`personal.ts:669-679`): con rol admin se fuerzan las nueve a `true`, y al bajar el
rol **no se apagan**.

**4 · El servidor no autorizaba.** De **68 endpoints**, 47 verifican el token y **7
comprueban algo más**. `api/_crud.js` —**14 tablas**— no tenía ningún gancho: cualquier
sesión válida podía reescribir la plantilla de una sucursal o publicar una norma.

**5 · El menú gateaba y la ruta no, en CINCO rutas.** La lección del 13/sep («el menú
no es un permiso») se había aplicado a `/personal` y no se barrió. La peor:
`/reportes`, **1 492 líneas sin una sola comprobación** — una anaquelista que en
`/tareas` solo ve lo suyo, ahí veía la auditoría completa de su sucursal.

**Escala: 400 condiciones de permiso en 63 archivos** del cliente.

#### LO QUE SE HIZO HOY (pasos B1 y B2, dos commits, UN despliegue)

**B1 — la escritura de la estructura se autoriza en el servidor.** Gancho `autorizar`
**opcional** en el factory (los otros 10 endpoints se comportan idéntico), declarado en
`plantillas`, `plazas`, `puestos-declarados` y `tareas-puesto`. La regla **no se
reescribe: se importa** — `esAdminGlobal` y `esJefatura` viajan compiladas a
`dist/manual`, las mismas que usa el navegador, y `compilar-manual.js` aborta el build
si tsc deja de emitirlas.

**B2 — cinco guards de ruta**, con la condición en `shared/audiencias.ts`, que importan
**el menú y el guard**. No pueden desalinearse porque no hay dos cosas que alinear.
`/descansos` tenía una tercera copia escrita a mano dentro del componente; ahora llama
al predicado compartido.

#### MI PREMISA ERA FALSA, Y ESO CAMBIÓ EL CANDADO

Propuse «solo admin» para la plantilla dándolo por hecho. `plantilla.ts:249` dice otra
cosa: **se abrió a cada jefatura para su sucursal el 13/sep**, por instrucción de David
(«déjalo libre — como crea tu plantilla de tu sucursal»). Un candado de solo-admin
habría roto exactamente lo que se había abierto. La guardia es el espejo de esa regla.

**Y el PATCH no manda sucursal.** `plantilla.ts:434` manda `{ cantidad }` y nada más,
así que la guardia la resuelve **de la fila**. Sin eso rechazaría a toda jefatura que
corrigiera una cantidad y solo pasaría Dirección: un candado que solo funciona en el
POST rompe el trabajo de todos los días.

#### `/api/coberturas` QUEDA FUERA, A PROPÓSITO Y MEDIDO

Lo escribe el pase de lista (una Encargada, que **no** es admin) **y** `login.ts:369`
**con el token de plaza**, para registrar la suplencia de quien entró. O sea que las dos
reglas obvias —«solo admin» y «la plaza no»— romperían un flujo vivo. Se cierra con el
rango unificado y su arnés. **Hasta entonces sigue abierto, y está dicho en la cabecera
de `_autorizar.js`.**

#### SE FALLA ABIERTO, COPIADO DE `api/usuarios.js` Y POR SU MISMO MOTIVO

Hay filas con el `rol` vacío (ids `admin`, `admin-local`) y sesiones sin ficha, así que
«no lo reconozco» **no es** «es un trabajador». Cada paso por la excepción se anota en
el log. La **única** excepción es el token de plaza, y es reconocimiento **positivo**
(`rol: 'plaza'`), no ausencia de dato.

**Y el token no lleva rango:** `_auth.js:59` devuelve `{uid, rol}` y el respaldo de
Firebase devuelve el token de Google, **sin rol**. Una autorización escrita como
`rol === 'admin'` a secas habría bloqueado a un administrador con sesión vieja, con un
403 que parece un permiso mal puesto. Por eso se resuelve la ficha.

#### LAS PRUEBAS, Y LOS CUATRO CONTROLES NEGATIVOS

`prueba-autorizacion-crud.js` (nuevo): **16 afirmaciones**, sin credenciales ni
producción (JWT_SECRET local + base simulada; **las reglas sí son las reales**). Aborta
si falta `dist/manual`, porque sin él la autorización pasa todo y la tabla saldría verde
sin medir.

`prueba-guards-ruta.js` (nuevo): **48 mediciones en el DOM**, 6 rutas × 8 sesiones.
Entrar = la URL se queda **Y** el componente se monta: solo la URL no basta, una ruta
puede conservar su path y pintar en blanco.

| | qué se rompió (una línea, `diff` comprobado) | qué pasó |
|---|---|---|
| NEG-1 | la guardia del factory no corre | 6 fallos nombrando cada fila; los 4 permitidos **no se mueven** |
| NEG-2 | no resuelve la sucursal de la fila | **exactamente 1** fallo, y es el PATCH de la Encargada — el que protege el trabajo diario. Un control que solo mirara «¿deniega?» habría dado **verde** |
| NEG-3 | `/reportes` vuelve a `authGuard` solo | 4 filas rotas reproduciendo el hueco literal; las otras 4 rutas intactas |
| NEG-4 | `veDescansos` devuelve `true` | rompe **LAS DOS** pruebas con una línea: el menú (escalada) y el guard. Es la prueba de que una sola definición gobierna las dos |

**Y LOS DOS ARNESES SE CORRIGIERON A SÍ MISMOS, con la misma falla.** Los dos abortaban
por falta de discriminación **antes** de reportar los fallos, así que con el candado
apagado decían **«no pude medir» (código 3) tapando las filas que nombraban el
defecto**. «No medí» y «está roto» son conclusiones opuestas (§8.11 a). Ahora los fallos
hablan primero y las guardias de integridad solo cuando todo lo demás pasó.

#### DESPLEGADO Y VERIFICADO

    marcador .. ruta-cerrada-para-tu-perfil  0 -> 1 servido · 38 controles en pie
                66 archivos · 4.50 MB · 0 fallos de lectura
    endpoints . los 5 de estructura montados y en 401 · tareas-puesto DELETE en 405
    log ....... arranca, migraciones al dia, el emisor carga su regla (ventana de 12
                lineas: una ausencia ahi no concluye por si sola)
    espera .... 4 vueltas, anclada al rotulo `status:` y a la LINEA COMPLETA

El marcador es la línea de consola del rebote, y **hacía falta igual**: cerrar rutas es
lógica pura y sin ella quien sigue un enlace viejo aterriza en sus tareas sin ninguna
pista, lo reporta como «la app me saca», y no hay error que buscar. Validado en las dos
direcciones antes de subir. **354 pruebas** unitarias y `prueba-menu-audiencias` con
**0 diferencias**: los 15 perfiles ven exactamente las mismas rutas que antes.

#### UN CAMBIO DELIBERADO, Y ES EL ÚNICO

`audiencias.ts` usa el `esAdmin` canónico (`esDueno || rol === 'admin'`) y no el
`rol === 'admin'` que `nav.config.ts` tenía **sombreado**. Hoy no hay diferencia real
—la sesión del dueño trae rol admin forzado en dos sitios independientes— pero estos
predicados ya no pintan un menú: **cierran puertas**. Solo puede afectar a un correo, así
que no ensancha el acceso de nadie más. Medido: entra a las cinco rutas **sin**
`rol: 'admin'`.

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **NO arregla el acomodo que David reportó.** Eso es el paso C (un solo `rangoDe()`
  derivado del `nivel`) y el D (el mapa de los 89 puestos, que **decide Dirección**).
  Hoy `auxiliar-encargado` sigue con perfil de mando.
- **Decisión tomada y sin implementar:** el Auxiliar de Encargado **cubre, no manda** —
  su autoridad sale de la cobertura del día, no de una bandera permanente. La pieza
  existe desde el 13/sep.
- **`/api/coberturas` sigue abierto** por el cable, y los otros 10 endpoints del factory
  también. Se cierran de a poco, cada uno con su medición.
- **Ninguna autorización se probó contra producción con un token real**, a propósito
  (§8.6): el mecanismo está probado localmente contra las reglas reales.
- **Nadie ha entrado con una cuenta real.** Las 48 mediciones son sesiones sintéticas en
  Chrome headless.
- **Cero migraciones y ningún número de tablero se movió.**

**Cifra del hallazgo 7 actualizada de paso:** son **36 de 68** endpoints con
`Access-Control-Allow-Origin: *` (el §3 dice 33 de 60).

#### EL AUDITOR QUEDA EN EL REPO — es el control del paso C

`scripts/auditar-privilegios-por-puesto.js` (solo lee, sin credenciales). Compila los
`.ts` reales y llama a `esJefatura`, `alcancePropuesto` y `menuDe` de verdad: no parsea
el catálogo ni reimplementa ninguna regla. **Las cinco cuentas de hoy quedan fijadas ahí
como línea base**, para que el paso C se pueda enseñar antes de aplicarlo y medir
después:

    1. con gente debajo y SIN perfil definido ......... 11
    2. el perfil contradice al nivel ................. 5 (+1 declarada: la cuenta del dueño)
    3. las dos reglas de rango discrepan ............. 6
    4. operativos con menu de jefatura ............... 3
    5. banderas que dan vista de supervisor .......... 9 de 9

Lleva sus tres controles y **afirman el mecanismo, no la aparición**: el positivo siembra
mando en un operativo concreto y exige que suba **esa** cubeta (no «algún número»); el
negativo exige que un puesto bien clasificado NO se reporte —sin él, una regla que
marcara todo pasaría el positivo—; y el de discriminación compara el menú de un
operativo-con-jefatura contra el de un anaquelista (5 rutas contra 2). Si algún día la
cubeta 4 sale en cero, lo dice en vez de callarse: **ese cero es el arreglo funcionando,
y hay que poder distinguirlo de «no medí»**.


### 19/sep/2026 — UNA SOLA DEFINICIÓN DE «VENCIDA», y el impacto medido es CERO

Instrucción de David: *«nadie calcula su propio tiempo»*, y frenar la limpieza
visual hasta unificar. Su argumento era fuerte: *«si la anaquelista está sudando
porque su tarjeta dice Vencida pero la Encargada la ve A tiempo, el sistema es
esquizofrénico»*.

**Y ese argumento venía de un reporte mío que era falso. Esta entrada existe sobre
todo por eso.**

#### LO PRIMERO FUE COMPROBAR LA PREMISA, Y SE CAYÓ

Se generó un día real de entregas con `planDeEntregas` —la misma función que corre
en el servidor— y se aplicaron las dos reglas hora por hora:

    45 entregas · 45 de 45 con `time` en el checklist
    45 de 45 donde TODOS los puntos usan la MISMA hora que el checklist

    hora    arbol(viejo)  por punto  DIFIEREN
    07:00              0          0         0
    09:00              0          0         0
    14:00              4          4         0
    20:00             25         25         0

**Cero diferencias.** `armarChecklist` hace `time: horaLimite` y le pone a cada
punto ese mismo valor, así que las dos reglas **ya coincidían en todo lo que emite
el robot**. La contradicción que reporté salía de **mi fixture de exploración**, que
ponía `horaLimite` en los puntos sin `time` en el checklist — una forma que el robot
nunca produce.

**La previsión de «la Encargada va a ver mucho más rojo» era falsa:** no ve ninguno
de más.

> **La lección, y es sobre mí:** el fixture que use para explorar tiene que tener la
> forma que produce el sistema, o los «hallazgos» son artefactos. Un fixture
> inventado no solo falla en no encontrar bugs: **fabrica bugs que no existen**, y
> éste llegó a cambiar la prioridad de un plan antes de que nadie lo comprobara.

#### DÓNDE SÍ DIVERGÍAN, que es lo que esto cierra

En las tareas creadas **a mano**. `checklist.ts` arma el checklist con
`time: tareasValidas[0].time` — **la hora del PRIMER punto**. Una Tarea Única con el
punto 1 a las 18:00 y el punto 2 a las 09:00 salía «a tiempo» en el árbol y
«vencida» en la tarjeta, a las 10:00, sobre el mismo dato. Hay un caso de prueba con
esa forma exacta.

**Exposición actual:** la bitácora midió *«Del manual 112 · Fuera del manual 0»* en
toda la empresa. Así que esto cierra una divergencia **latente**, no una visible.

#### Y NO ERA UN PARCHE DELIBERADO

La hipótesis razonable era que el `23:59` se puso para que el organigrama no se
llenara de rojo a media mañana. `git log -L` dice otra cosa: **nació así el 28/ago**
con el commit que introdujo el árbol, sin comentario. No se quita una indulgencia de
negocio; se quita una incoherencia. Importa: si hubiera sido deliberada, unificar
habría revertido una decisión de operación sin que nadie lo pidiera.

#### LO QUE SE HIZO

`esChecklistVencido(checklist, estaCompleto, ahora)` en `urgencia-tarea.util.ts` es
la única regla. `vista-organigrama.ts:esVencida` pasa a ser un delegado de dos
líneas; la línea de resumen la hereda porque ya recibía la regla inyectada.

**Las dos ramas de fecha no se pierden.** La regla vieja tenía `if (date < hoy)
return true` y `if (date > hoy) return false`; la nueva las cubre calculando el
límite sobre `c.date`. Hay dos casos que las fijan: **quitar una rama por «es
equivalente» sin probarlo es como se pierden los bordes.**

#### VERIFICADO EN LAS DOS DIRECCIONES

Un cambio que no cambia nada en ningún sitio es indistinguible de uno que no se
aplicó, así que hacen falta las dos mitades:

- **No-op donde debe:** los **doce** arneses del módulo en verde, más el móvil.
  **Cero fixtures cambian de estado.**
- **Efecto donde debe:** el fixture divergente pasa de **«6 a tiempo» a «6
  vencidas»**, y la columna del árbol muestra 6/2/3/1 donde iba en blanco.

**354 pruebas** unitarias (345 → 354). Desplegado y verificado: marcador nuevo
servido, **37 controles en pie**.

#### Y LA COLUMNA DEJA DE LLAMARSE «Venc.»

Una abreviatura ahorra cuatro píxeles y cuesta medio segundo de descifrado por
lectura, todos los días: esa cuenta sale siempre mal. Y hasta hoy **mentía a
medias**, porque la contaba con la regla permisiva del árbol y no con la que ve
quien trabaja. Es además el marcador del despliegue: unificar es lógica pura y no
introduce ninguna cadena propia (el mismo caso de la Fase 2.1).

#### LO QUE ESTO NO HACE

- **Nadie ha entrado con una cuenta real.**
- **No cambia un solo número en producción hoy**, y eso está medido, no supuesto.
- **`checklist.ts` sigue armando el checklist con la hora del primer punto.** Esto
  hace que ya no importe para juzgar el retraso —todos leen por punto— pero el campo
  `time` del checklist sigue siendo engañoso para cualquiera que lo lea en crudo.
- Siguen los **22 controles** y los **529px** de cromo antes del árbol en teléfono.
  Ésa es la Capa 2.


### 18/sep/2026 — CAPA 1: la línea que contesta «¿quién no ha entregado?»

Diagnóstico acordado con David, y es la premisa de todo lo que sigue: **abrumar no
es cantidad, es no saber dónde mirar.** Medido: **22 controles** en la primera
pantalla de una Encargada contra **9** en la de una anaquelista, y ninguno dice cuál
es el primero. Con una línea que conteste arriba, el resto deja de agobiar **sin
haber quitado nada**, porque el ojo ya tiene dónde aterrizar.

Ahora la barra del árbol dice: **«Mi equipo · Faltan 6 entregas · 2 vencidas · 4 a
tiempo»**.

#### NO DICE «12 DE 15 ENTREGADAS», QUE ERA LA FORMA PEDIDA — y está medido

Sirviendo 5 entregas del equipo con 2 marcadas `enviado`, el árbol contó **3**. La
lista que alimenta esta pantalla **no trae las ya entregadas**: el historial se carga
aparte y bajo demanda. Un «N de M» diría **«0 de 3»** al aterrizar, todos los días,
hasta que ella tocara otra pestaña.

Es exactamente la trampa que este repo ya documentó y rechazó para los badges de la
barra: *«un cero que significa "no lo he leído" y se ve idéntico a "no hay". Mejor
sin número que con uno que miente.»* Así que se cuenta solo lo que sí está en
memoria: lo pendiente — que además **es** su pregunta.

**Los tres números cuadran** (`vencidas + aTiempo === pendientes`) y hay un caso que
lo fija sobre una muestra con solapamiento posible. Tres números juntos se leen como
partes de un todo: si no sumaran, la línea mentiría sin dar un solo error.

**Y el vacío no dice «todo entregado»**: con cero pendientes no se puede distinguir
de «hoy no se emitió nada», porque las entregadas ni siquiera están en esta lista.
Afirmarlo taparía justo el día en que el robot no corrió (§5.2).

#### SIN `*ngIf` DE ROL, Y ES DELIBERADO

La propuesta llevaba un `esOperacionPiso` para que Dirección no viera «un resumen
roto o en ceros». **No hace falta:** el bloque vive DENTRO del árbol y hereda su
gate, y cuenta lo que la pantalla ya está autorizada a enseñar, sin suponer que quien
mira es de piso. Medido: Dirección ve «Faltan 6 · 2 vencidas · 4 a tiempo» — su
alcance, ni roto ni en ceros.

Cada gate de rol nuevo es una forma más de dejar ciego a alguien sin enterarse. Éste
no compraba nada.

#### DOS ARNESES AJENOS ME CORRIGIERON, Y LOS DOS TENÍAN RAZÓN

**1. `prueba-arbol-organigrama` cazó que la línea le quitaba sitio al árbol.** Vigila
desde el 4/sep que a la lista le toque ≥55% de la pantalla —porque David pidió «hazlo
más grande»— y cayó al **52%**, **nombrando al culpable**: `org-resumen=52`. O sea
que el bloque puesto para ayudar a mirar le estaba quitando sitio a lo que hay que
mirar.

> **Y aquí está la lección, que es sobre cómo trabajé, no sobre el código.** Me puse a
> limar píxeles: 52 → 40 → 30, escondiendo cosas para hacer hueco, midiendo otra vez.
> Iba por la tercera vuelta cuando quedó claro que el arreglo no era **encogerla**
> sino **moverla**. Puesta en el renglón del subtítulo, SUSTITUYE a «N puestos · M
> entregadas hoy» en vez de sumarse: mismo alto, y cambia un número decorativo por uno
> accionable. Resultado: **58%**, la línea base exacta, y **cabe una fila más que
> antes del cambio**. Cuando uno lleva tres iteraciones optimizando contra un umbral,
> casi siempre el problema es la forma, no el tamaño.

**2. En teléfono se partía en tres renglones** (92px) y dejaba el árbol en y=842 de
844 — la línea que existe para que el ojo aterrice estaba escondiendo el trabajo. Era
un hijo flex sin `min-width: 0`. Con el renglón completo cuesta **20px** y la
respuesta queda sobre el pliegue.

**Y mi propia aserción estaba mal planteada:** exigía que el árbol cupiera sobre el
pliegue en un teléfono, y eso **no era cierto antes de este cambio** (780px de cromo
antes de él). Una guardia que falla por algo ajeno se afloja en tres semanas. Ahora
distingue **«lo rompí yo»** de **«ya estaba roto»** comparando contra la línea base
sin el bloque, y lo que afirma es lo único que esta capa puede prometer: **que la
respuesta se vea sin scroll**.

#### ⚠ EL HALLAZGO QUE ESTO DESTAPÓ: TRES DEFINICIONES DE «VENCIDA»

Al decidir qué regla usar apareció que en el módulo conviven **tres**:

    vista-organigrama.ts:1207   String(c.time || '23:59')      <- pinta el arbol
    checklist.ts:isTareaVencida  por horaLimite de cada PUNTO
    urgencia-tarea.util          el punto pendiente mas proximo  <- la tarjeta

Al resumen se le **inyecta** la del árbol, a propósito: lo único inaceptable es que
la línea contradiga a las filas que tiene **debajo**. Pero **contradice a la tarjeta
del trabajador, y eso se VE**: sobre el mismo fixture, su tarjeta dice «Se pasó la
hora (era a las 09:00 AM)» y este resumen dice «a tiempo».

**No lo introduce este cambio — lo hace visible.** Unificarlas es un paso propio
porque cambia qué se marca en rojo para todo el mundo, y eso no viaja de contrabando
en una línea de resumen.

#### LO QUE ESTO NO HACE

- **Nadie ha entrado con una cuenta real.**
- **No quita ni un solo control.** Siguen los 22; lo que cambia es que ahora hay
  dónde aterrizar. Bajar `RAMA`, `PROPIO`, `VENC.` y las seis decisiones que la
  pantalla exige por omisión es **Capa 2**.
- **En teléfono el árbol sigue pidiendo scroll**: se consumen **529px** antes de él
  (cabecera, título, 4 bandejas, 3 botones de crear). Es el número que Capa 2 tiene
  que atacar, y queda impreso por el arnés en cada corrida.
- **No mueve ningún número de tablero.** Cero migraciones, cero escrituras.

**345 pruebas** unitarias (334 → 345) y los **nueve** arneses del módulo en verde, en
escritorio y a 390px reales.


### 18/sep/2026 — REVISIÓN DE USUARIO FINAL (2/3): el árbol, y una optimización que NO se hizo

Instrucción de David: meterse a fondo en las secciones de Tareas y hacerlas **más
óptimas**, en las dos lecturas —más simple de usar y más ligera—. Eligió las cuatro
zonas del módulo.

#### LO PRIMERO FUE MEDIR SI HABÍA ALGO QUE OPTIMIZAR. NO LO HABÍA.

El inventario estático daba miedo: **447 KB** de chunk, **76 de 487 clases CSS sin
usar**, **40 de 263 métodos sin una sola llamada** y —lo que parecía el hallazgo—
**135 llamadas a método dentro de un `*ngFor`**, que corren por fila y por ciclo de
detección. Es la familia exacta de la caída del 1/sep, así que iba directo a eso.

**La medición lo mató.** Prueba de escala con tres tamaños, tiempo real (sin reloj
virtual: comprime los temporizadores y cualquier milisegundo sería ficción):

    tarjetas   nodos   ms/ciclo
           5     266       9.85
          30   1 041       9.59
         112   3 583      10.30

**22.4× más tarjetas cuestan 1.0× por ciclo.** El ~10 ms es el coste fijo del
`setTimeout` del propio arnés, no trabajo por fila. Las 135 llamadas **no cuestan
nada**: son un hallazgo estático, no un problema. Optimizarlas habría sido dos días
de trabajo para mover cero.

> **Y el primer instrumento mintió, de forma estable.** La versión inicial daba
> **0.03 ms/ciclo y 0 mutaciones** con 3 583 nodos — que se lee como «la app vuela».
> Era un bucle `for` apretado de 30 clics: zone.js dispara la detección en
> `onMicrotaskEmpty`, o sea DESPUÉS de la tarea actual, así que los 30 eventos se
> encolaban y la detección corría una vez al final, fuera de la ventana medida.
> Lo destapó ponerle un **control que pulsa una pestaña que sí cambia el DOM** y
> exigir mutaciones > 0: dio 14, y con los clics separados por un yield las cifras
> pasaron a ser reales. Un «demasiado bueno» es tan sospechoso como un cero.

**Lo que esto deja escrito, y vale para la próxima:** en este módulo, **el peso y la
mantenibilidad son reales; la velocidad no**. Las 76 clases y los 40 métodos muertos
siguen siendo deuda —de lectura y de descarga—, pero **no** de tiempo de respuesta, y
venderlos como «la app irá más rápida» sería falso.

#### EL ÁRBOL DE LA ENCARGADA: ARREGLADO Y DESPLEGADO

El defecto aislado ayer, cerrado. La causa **no** era que el padre heredara mal el
conteo —`entregasArbol` cuenta la rama y eso alimenta la columna RAMA—: era **el
orden de la pregunta**. La salida de «servicio a» se evaluaba antes de bajar, así que
el primer nodo del recorrido cumplía las dos condiciones en cuanto hubiera **una sola
entrega en toda la empresa**, y el recorrido se detenía ahí con la empresa colgando.
Un ancestro del propio puesto nunca es «servicio a»: es el camino a casa.

**La prueba nueva no podía ser solo «la raíz es su puesto»**: eso lo pasaría un
arreglo que borrara la salida de «servicio a» entera, y con ella una Encargada
dejaría de ver a la gente de otras áreas que trabaja en su tienda.

    escenario                     entregas  raíces  cruzadas  título            raíz
    CON trabajo (6 entregas)             5       2         3  Mi equipo         Encargado(a)
    SIN trabajo (0 entregas)             0       1         0  Mi equipo         Encargado(a)
    solo lo suyo (sin lo ajeno)          4       1         0  Mi equipo         Encargado(a)
    CONTRASTE: Dirección ve todo         6       1         0  Organigrama 2026  Dirección General

**Control negativo, una línea:** caen 4 aserciones, una reproduce la captura literal,
y destapa algo que no se venía a buscar —sin la condición, con trabajo **solo suyo**
salían **6 pastillas «servicio a»**, o sea que la app marcaba su propia rama como de
otro—. Y la fila de 0 entregas **sigue verde**: es exactamente por lo que esto vivió
una semana desplegado.

**El título dice de quién es el árbol.** Desde que arranca en el puesto de quien
entra, «Organigrama 2026» nombra otra cosa. Además es el marcador del despliegue: el
arreglo es lógica pura y no introduce ninguna cadena propia (el mismo caso de la
Fase 2.1), así que sin esa línea el despliegue habría sido inverificable.

#### TRES ERRORES MÍOS, Y LOS TRES SON DE PREMISA — no de código

1. **Escribí en un comentario que el filtro «Solo con manual» se comía la entrega de
   un vendedor.** Es falso: la poda conserva todo puesto con entregas del día. Lo que
   faltaba era otra cosa (la entrega de la propia Encargada: «del equipo» es estricto
   desde el 14/sep). Corregido en el archivo, porque **una explicación equivocada en
   un comentario se cita después como si fuera dato**.
2. **Puse `alcance: 'todas'` en la sesión de Dirección. ESE VALOR NO EXISTE** — la app
   usa `'global'` y `'sucursales'` (`permisos.util.ts:78` y `:95`). Con el inventado,
   el árbol contó **0 entregas**, y estuve a un paso de reportar «un administrador ve
   la operación vacía». Con los dos valores reales cuenta las 6: **no hay defecto**.
   Es el §8.5 mordiendo en un fixture: inventé un dato y casi produce una alarma.
3. **Un aislamiento que midió tres veces el mismo archivo.** Para separar qué campo
   causaba el cero corrí tres variantes… con `cp` de bash a `/tmp` y `python` de
   Windows, que no ve esa ruta. Los tres reemplazos fallaron, las tres corridas
   usaron el mismo fichero y dieron el mismo número. **Los *tracebacks* estaban en
   pantalla y casi leo la tabla como resultado.** Rehecho con una ruta que las dos
   herramientas ven y con un `assert` de no-op.

#### LO QUE ESTO NO HACE

- **Nadie ha entrado con una cuenta real.** Todo son sesiones sintéticas.
- **La Encargada sigue sin poder contestar «¿quién no ha entregado hoy?» de un
  golpe.** El árbol ya arranca donde debe, pero la pregunta que ella abre la app para
  contestar aún necesita abrir ramas.
- **Los tres asistentes de creación no se han tocado** (7 pasos para una tarea única,
  y los 14 `alert()` nativos que quedan viven ahí).
- **Las 76 clases y los 40 métodos muertos siguen ahí**, ahora con su justificación
  correcta: son deuda de peso y de lectura, no de velocidad.


### 18/sep/2026 — REVISIÓN DE USUARIO FINAL (1/3): el envío de la anaquelista

Instrucción de David: revisar el módulo de Tareas **actuando como usuario final
primerizo**, módulo por módulo, y llegar juntos a una interfaz más simple. Y después,
con el hallazgo enfrente, su orden de ataque: anaquelistas primero (154 personas),
luego Encargadas, y al final el defecto del organigrama.

**NO SE LEYÓ EL CÓDIGO PARA OPINAR: SE MIRÓ LA PANTALLA.** Arnés de exploración con
**capturas** —sesiones sembradas de anaquelista y Encargada, escritorio 1422px y
teléfono **390px reales** vía iframe, porque Chrome topa el ancho de ventana en
~500px y `--window-size=390` mediría el escritorio dando verde sin tocar el caso.

#### LO QUE ESTABA BIEN, Y CONVIENE QUE ESTÉ ESCRITO

Lo táctil **aguanta**: `--tap-min=44px` aplicado, y sobre **10 controles medidos en
la lista y 8 en la pantalla de trabajo, CERO por debajo de 44px**. Sin desbordamiento
horizontal (390 de 390). El trabajo del 13/sep sostiene. El problema no era el tamaño
del dedo: era el **idioma y la jerarquía**.

#### UN DEFECTO QUE ME INVENTÉ Y RETIRÉ EL MISMO DÍA — y la lección es del método

Reporté que el botón de bandeja activo se pintaba en el equivocado. **Era falso.**
`getComputedStyle` bajo `--virtual-time-budget` devolvía estilos rancios de forma
**estable durante 4 segundos**, así que repetir la medición no lo destapó: la
confirmó. Lo tumbó **ampliar la captura**, que es lo que el usuario ve de verdad.

> **Regla que deja:** cuando el instrumento y la imagen se contradicen, **gana la
> imagen**. Y una medición que se repite igual no es una medición verificada: un
> instrumento roto es reproducible.

#### LOS TRES DEFECTOS DE LA PANTALLA DE TRABAJO, Y SUS CIFRAS

1. **El `confirm()` del navegador en el momento de la verdad de 154 personas.**
   Truncaba la lista a 5 puntos —el checklist de apertura tiene 8—, no se puede
   redactar ni medir, y en iOS sale con el dominio encima.
   **Corrección de una cifra que venía en el plan:** no son «20 `confirm()`». Son
   **3 `confirm()` y 18 `alert()`** en el módulo (4 y 22 en toda la app), y no son
   la misma pieza —uno pide una decisión, el otro es un callejón sin salida—.
   **Y no congelan los teléfonos.** Lo que se colgó fue MI arnés: headless con tiempo
   virtual, donde nadie pulsa el botón del cuadro. Venderlo como «congela» lo
   desmiente el primer teléfono real y se pierde el argumento bueno, que es que ese
   cuadro no lo gobernamos nosotros.
2. **La lista no decía NADA de la hora.** Medido: dos tareas de 07:00–09:00 a las
   10:13 salían limpias. `esAtrasada` no servía para esto —solo se enciende para
   Espacio TEC y para días **anteriores** (`checklist.ts:2146`)—, así que una tarea
   de HOY cuya ventana ya pasó **nunca** la encendía.
3. **El aviso de vencida, un párrafo entero repetido palabra por palabra en CADA
   punto.** Con 3 ocupaba más alto que los puntos.

#### LA DECISIÓN CARA LA TOMÓ DAVID, CON LAS TRES SALIDAS Y SU PRECIO

El plan decía «si la foto es obligatoria, el botón simplemente no se habilitará». Se
le puso el precio medido enfrente: son **377 puntos con foto obligatoria** y **62+
declaraciones donde no hay qué fotografiar** (deuda ya registrada del 3/sep), así que
un botón muerto deja a esa gente **sin poder cerrar su turno**, y «no me deja» se lee
igual que «la app no sirve». Eligió la tercera: **se envía, con motivo obligatorio
por punto**. Nadie se traba y la causa queda escrita.

**⚠ EL MOTIVO NO CIERRA NADA, Y ESO ES LO ÚNICO QUE HAY QUE RECORDAR.** Se guarda en
`item.motivoSinPrueba` y **jamás** en `checklist.notaEmpleado`: ese campo lo lee
`tieneJustificacionChecklist()`, así que escribir ahí habría pasado **todos** los
puntos del checklist de `no_ejecutado` a `justificado` —incluidos los que nadie
justificó— y con ellos **a quién se le cuenta la falta** (§4). Guardar un dato en el
campo de al lado se ve inofensivo y aquí mueve el reparto de responsabilidad. Hay dos
pruebas que lo fijan. Es la Fase 2.1 defendida por la puerta de al lado.

#### DOS DEFECTOS MÍOS, Y CADA UNO LO CAZÓ UNA COSA DISTINTA

- **Lo cazó la PRUEBA:** la cuenta regresiva usaba la gracia de 59 segundos del
  límite, así que inflaba **todos** los números en un minuto —«121» a las 08:00 para
  una tarea de las 09:00— y al filo decía «Vence en 1 min» con la hora ya pasada. La
  cuenta va contra el minuto; el perdón, contra el segundo. Cinco casos en rojo, y
  **la equivocada era la regla, no la expectativa**.
- **Lo cazó MIRAR, con el arnés en verde:** había reproducido el defecto en pequeño.
  El chip «Se pasó la hora: 09:00» salía **3 veces, la misma hora**, bajo un aviso que
  ya lo decía. Ahora solo se pinta cuando los puntos tienen horas **distintas**, que
  es el único caso donde el aviso de arriba no alcanza. Y el botón apagado se pintaba
  en el naranja de acción: tenía el aspecto exacto de «púlsame» sin hacer nada.
  **Medir no sustituye mirar** (7/sep), otra vez.

**Y al arreglar el chip, su columna se fue a cero en las seis filas** — un cero que
significa «nunca se ejerció», no «no se pinta cuando no debe». Se agregó una tarea de
fixture con **dos horas límite distintas** y una guardia que aborta si el chip sale en
todas las filas o en ninguna.

#### LAS CIFRAS

**334 pruebas** unitarias (294 → 334) y `scripts/prueba-envio-anaquelista.js`, **6
escenarios en el DOM**:

    escenario                           reloj chips modal filas nativos enviada
    abro mi tarea sin fotos                 1     0     0     0       0       0
    pulso Enviar con 0 de 3                 1     0     1     3       0       0
    contesto los 3 motivos                  1     0     1     3       0       0
    horas DISTINTAS: sale el chip           1     2     0     0       0       0
    CONTRASTE: tarea con sus fotos          0     0     0     0       0       0
    CONTRASTE: enviar la que sí las tiene   0     0     0     0       0       1

**El cero de «nativos» no vale solo**: el guion llama a `confirm()` a propósito al
final y **aborta** si el contador no sube. «0 diálogos» y «no intercepté» se ven
idénticos (§8.11 a). **Control negativo**, una línea (5302 → 5301, `diff` comprobado):
devolviendo el `confirm()` viejo caen 5 aserciones **nombrando el mecanismo**
—«salieron 1 cuadro(s) DEL NAVEGADOR»—, el escenario siguiente dice **«no pude
medir»** en vez de fingir un fallo, y las filas 1, 4 y 5 no se mueven.

#### DESPLEGADO Y VERIFICADO

    marcadores  sp-modal · cl-reloj · «no van a contar como hechos»
                dist 4/11/1  ->  produccion 0/0/0 ANTES, los tres servidos DESPUES
    controles   31 en pie · 66 archivos · 4.50 MB · 0 fallos de lectura
    espera      8 vueltas, anclada al rotulo `status:` y a la LINEA COMPLETA

Los dos marcadores del plegado bajan a control: ya valían 1, y dejarlos como `nuevo`
habría dado verde sin comprobar nada de hoy.

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **NADIE HA ENTRADO CON UNA CUENTA REAL.** Los 6 escenarios son sesiones sintéticas
  en Chrome headless: prueban **qué hay delante** de quien entrega, no que se **vea**
  bien en un iPhone. Y Chrome no es Safari (13/sep).
- **No mueve ningún número de tablero.** Cero migraciones. `motivoSinPrueba` es un
  campo que hoy no lee nadie más.
- **SIGUEN DOS MODALES SEGUIDOS** cuando faltan fotos **y** hay retraso: primero el
  motivo por punto, luego el justificante del checklist. Son dos preguntas distintas
  y no se fusionaron. Va en el paso 2.
- **Quedan 14 `alert()`** en el módulo, todos en los flujos de **creación**
  (asistentes de tarea única, bloques, equipo), que son de la Encargada.
- **«Panel Enterprise» no era un componente compartido:** estaba copiada a mano en
  **11 plantillas**. Se quitó (commit aparte); **queda a propósito** la del PDF de
  auditoría de `reportes.ts:920`, que lee gerencia y no quien trabaja en piso.

#### LO QUE FALTA DE LA REVISIÓN, con el defecto ya aislado

**El árbol de la Encargada se desenraiza en cuanto hay trabajo**, y está medido con el
control que lo nombra —misma sesión, mismos usuarios, cambiando **solo** el número de
entregas—:

    0 entregas  ->  raiz: «Encargado(a) de Sucursal»                        ✓
    6 entregas  ->  raiz: «Dirección General»  servicio a DIRECCIÓN GENERAL  ✗

**La causa NO es que el padre herede mal el conteo** —`entregasArbol` cuenta la rama y
eso es correcto: alimenta la columna RAMA que la Encargada lee—. Es **el orden de la
pregunta**: `vista-organigrama.ts:546` evalúa la salida de «servicio a» **antes de
bajar**, así que atrapa a un nodo que es **ancestro del propio puesto** y el recorrido
se detiene ahí con la empresa entera colgando. El arreglo es impedir que un ancestro
tuyo se declare «servicio a»; separar conteos locales de globales cambiaría **los
números que hoy se muestran**, que ya no es navegación sino dato.

**Y por qué ninguna prueba lo vio:** `prueba-vista-por-nivel.js` sirve `/api` **vacío
a propósito** —su propia cabecera lo dice— y cero entregas es justo el único estado en
que el enraizado funciona. Corolario (c) literal: el control pasa por un camino donde
el caso no puede ocurrir.



### 17/sep/2026 — LA LISTA SE PLIEGA: cada bloque es un botón que se desglosa

Instrucción de David, sobre la captura de «8 Esquinas · 42 tareas» con las tarjetas debajo:
*«no lo quiero solo así, quiero que esté dentro de botones y de ahí se desglose»*. Y las dos
decisiones que tomó enfrentado a las opciones con su precio: **dos niveles** (sucursal y
persona), **todo cerrado** al entrar, y **sin recordar** nada entre sesiones.

El agrupado por sucursal salió esta misma mañana, así que el defecto duró horas: los dos
encabezados eran `<div>` de adorno y la bandeja escupía las 42 tarjetas de golpe. Para llegar a
la tercera sucursal había que recorrer cien tarjetas con el dedo.

**LO QUE NO SE HIZO, Y ES LA DECISIÓN DE FONDO.** Las tarjetas **no se envuelven** en un
contenedor. La lista es una rejilla CSS y meterlas dentro de un `<div>` las aplastaría en una
sola celda: se esconden con `*ngIf` y los encabezados conservan su `grid-column: 1 / -1`. Cero
riesgo para el diseño de la tarjeta, que es lo único que ya funcionaba.

**EL CONJUNTO GUARDA LOS ABIERTOS, NO LOS CERRADOS**, y con «todo cerrado» el conjunto vacío
**es** el estado inicial. Al revés habría que registrar cada grupo que nace, y el que llegara
sin registrar aparecería abierto: el poll de 20 s iría abriendo bloques solo cada vez que
entrara una sucursal nueva. Es la misma decisión que ya tomó el árbol del organigrama (2–3/sep).

#### ⚠ TRES BLOQUES NO SE PLIEGAN, y sin eso el cambio habría sido un desastre mudo

Plegarlo todo es fácil; el riesgo es dejar a alguien mirando **botones sin sus tareas**, que se
ve idéntico a «no tengo trabajo» (§5.2). Las tres salidas son la misma regla —plegar solo sirve
cuando hay **entre qué elegir**—:

1. **El encabezado no se pinta.** Sin botón no habría forma de volver a abrirlo.
2. **Una sola persona en la bandeja.** Es «Mis tareas» de los **154 que entregan**: abrirían la
   app para encontrar su propio nombre y cero tarjetas, y tendrían que pulsarse a sí mismos
   para trabajar.
3. **Hay búsqueda escrita.** Quien tecleó «Pasillo» ya recortó la lista; esconderle el
   resultado detrás de un clic es deshacerle el trabajo.

#### LA PRUEBA, Y LOS DOS CONTROLES NEGATIVOS

`scripts/prueba-lista-plegable.js` (nueva), 6 escenarios en el DOM sobre **Enviadas** —la
bandeja de la captura, y la única donde un supervisor ve esta rejilla: en «Pendientes del
equipo» se pinta el árbol—:

    escenario                           suc  per  tarjetas
    entro a Enviadas (todo cerrado)       2    0         0
    abro 8 Esquinas                       2    2         0
    abro 8 Esquinas y a Claudia           2    2         3
    abro Canindo (la otra sigue cerrada)  2    1         0
    escribo en el buscador                0    1         1
    TRABAJADORA: sus tareas, sin pulsar   0    1         3

**Las cifras del fixture son distintas a propósito** (8 Esquinas 5, Canindo 2): con dos bloques
del mismo tamaño, pulsar el equivocado daría el mismo conteo y la prueba pasaría en verde sin
distinguir cuál se abrió. Los dos controles, **una línea cada uno**, con el `diff` comprobado
contra una copia buena (5 126 → 5 126 líneas):

| | qué se rompió | qué pasó |
|---|---|---|
| NEG-1 | `sucAbierta` ignora el conjunto | 6 aserciones, y la **guardia de discriminación** nombra el mecanismo: «abrir 8 Esquinas y abrir Canindo dan el mismo número de personas» |
| NEG-2 | se quita la guarda de «una sola persona» | **exactamente 1**: la de la trabajadora, que pasa de 3 tarjetas a **0** |

**NEG-2 es el que vale.** Rompe una sola fila, y es la que protege a los 154: sin esa guarda, el
plegado de arriba seguiría viéndose precioso mientras quien entrega abre la app y no ve nada.

#### DOS CONTROLES AJENOS CADUCARON, Y SE SUSTITUYEN EN ESTE MISMO COMMIT

Corolario (e) en vivo: `prueba-buscador-y-agrupacion` (7 aserciones rotas, reportando «el
buscador no filtra» sobre un buscador **intacto**) y `prueba-tareas-unidas` (abortó por falta de
discriminación). Los dos contaban `.checklist-card`, y desde hoy esas tarjetas nacen escondidas.

**No se aflojaron: se les enseñó a abrir los bloques antes de contar**, pulsando solo lo que se
anuncia cerrado (`aria-expanded="false"`), que es **el mismo atributo** que mira la prueba nueva.
Si alguien invirtiera ese atributo, las tres caerían juntas en vez de que una tape a la otra.

#### EL MARCADOR IBA A SER UN FALSO POSITIVO, y se vio midiendo

`alternarSuc` —el método nuevo— daba **2 en producción** antes de desplegar nada. No es magia:
es prefijo de `alternarSucursal`, que vive en Bloques y en Venta de Promos desde hace meses. Un
`grep` de subcadena no sabe dónde acaba un identificador. Los buenos son de CSS, validados en
las dos direcciones: `cl-grupo-flecha` 0 → 4 y `cl-grupo-abierto` 0 → 7. Y `cl-grupo-suc`, que
era el `nuevo` de esta mañana, **baja a control**: ya vale 9.

**Y el heredoc se rompió otra vez** con las comillas anidadas del guion inyectado —sexta vez en
el repo—. Se reescribió con la herramienta que no interpreta el contenido, y el guion se arma
**uniendo un arreglo de líneas** en vez de concatenar con `+` al final de cada una: así una coma
olvidada es un error de sintaxis en Node, no un guion truncado que se lee como «la app no pintó».

**Mi propia guardia también abortó dos veces, y las dos veces tenía razón:** un `templateOutlet`
en minúscula que no casaba con `ngTemplateOutlet`, y un fixture que le daba a la jefa una sola
sucursal en `/api/usuarios` —la app **resincroniza el perfil** y pisa lo sembrado en la sesión—,
así que Canindo nunca llegaba. Ninguna de las dos escribió nada: dijeron «no pude medir».

**Y un esperado que puse a ojo y estaba mal:** escribí `sucBotones: 1` para el escenario del
buscador y son **0**, porque `mostrarEncabezadoSucursal` ya decía desde antes que con un solo
grupo el encabezado es ruido. Corregido **derivándolo de la regla**, con el porqué escrito en el
caso para que no se lea como ajustar la expectativa al artefacto.

**294 pruebas** unitarias en verde (sin tocar ninguna), más `prueba-dom-evidencia`,
`prueba-arbol-organigrama` y `prueba-vista-por-nivel`, que siguen pasando.

**Lo que esto NO hace:** no mueve ningún número de tablero, no toca la tarjeta ni
`panel-responsables`, no hay migración, y **nadie ha entrado con una cuenta real** — los seis
escenarios son sesiones sintéticas en Chrome headless. Falta también un «abrir todo» para quien
tenga diez sucursales: hoy son diez clics y David no lo pidió.


### 17/sep/2026 — «NO ESTÁ FUNCIONANDO EL BUSCADOR»: y el agrupador no existía

Reporte de David, con captura de «Enviadas del equipo»: *«no esta funcionando el buscador y
tampoco el agrupador de los usuarios para que los tengas por sucursal»*. En la captura había
tecleado **«la piedad abastos»** y las cuatro tarjetas en pantalla eran de **Padre Hidalgo**,
con el contador intacto en **(94)**.

**LAS DOS CAUSAS, Y NINGUNA ERA «la regla está mal escrita».**

**1 · El filtro de texto vivía DENTRO de `checklistsFiltrados`**, que solo alimenta
**Pendientes**. La bandeja de la captura se pinta desde `enviadasFiltradas`, que recortaba por
*de quién es la tarea* y **nunca leía `terminoBusquedaChecklist`**. O sea que el buscador
funcionaba en media pantalla y no en la otra media — el peor modo de fallo posible: **no da
error y no se queda vacío**, devuelve la lista COMPLETA, que se lee como «no hay más
resultados». Quien busca concluye que esas tareas no existen.

**2 · EL AGRUPADOR NO ES QUE NO FUNCIONARA: NO SE PINTABA NUNCA.** Y esto solo se ve juntando
dos condiciones que están en archivos distintos:

    contenedor (checklist.html)  *ngIf="vistaHistorial() === 'pendientes' && !verPorOrganigrama"
    boton                        *ngIf="puedeFiltrarVista && vistaTareas === 'equipo'"
    y  verPorOrganigrama   ===   puedeFiltrarVista && equipo && pendientes

Sustituyendo: el botón pedía `!(A && B && C) && A && B && C`. **Contradictorio.** No había una
sola combinación de sesión y bandeja en la que ese control apareciera. Verificado en el DOM y
no solo razonado: la columna `btn` del arnés vale **0** en el escenario de supervisión.

**Y DE AHÍ SALE UN HALLAZGO QUE NADIE BUSCABA: `<app-panel-responsables>` ES CÓDIGO MUERTO.**
Su `*ngIf` es `mostrandoPanelResponsables`, que exige `!verPorOrganigrama` **junto con** las
tres condiciones que definen `verPorOrganigrama`. Misma contradicción, un nivel más arriba.
`agrupacion` es un signal que nace en `'organigrama'` y **nunca se cambia** (comprobado: 0
asignaciones en todo el repo), así que desde que el interruptor de vista se retiró, ese panel
de 365 líneas no se pinta para nadie. **No se borró** —quitarle la entrada y el código en el
mismo paso deja sin nada que recuperar, la lección de `limpiarHuerfanas`— y sí recibió el
agrupado por sucursal, para que esté listo el día que se decida reactivarlo o enterrarlo.
Queda anotado como pendiente: **es una decisión de David, no limpieza.**

#### LO QUE SE HIZO, Y LA MITAD QUE IMPORTA ES DÓNDE VIVE LA REGLA

`shared/filtro-busqueda.util.ts` (nuevo) y `shared/agrupacion-entregas.util.ts` (nuevo). Copiar
el `filter` al historial habría «arreglado» la captura y dejado **dos reglas de búsqueda libres
de discrepar**: el día que alguien agregue un campo buscable en una, la misma búsqueda
devolvería dos listas distintas según la bandeja — que es el defecto de hoy reintroducido por
la puerta de al lado. Una definición, dos listas.

**El buscador ahora ignora acentos**, en los dos lados y con `normalizarNombre` —la misma
función con la que la app cruza identidades, no una tercera—. No es purismo: en un teléfono
nadie escribe «Yurécuaro» con acento, y hasta hoy esa búsqueda no encontraba nada **sin que la
pantalla dijera por qué**.

**El agrupador pasa de booleano a tres modos** —sucursal · persona · lista plana— en un solo
botón, presente en las cuatro bandejas, con la elección recordada por navegador (`try/catch`:
en una ventana privada `localStorage` LANZA, y eso tumbaría el componente entero por una
preferencia de vista).

**⚠ EL ÁRBOL DEL ORGANIGRAMA NO SE TOCÓ**, por instrucción expresa (*«solo no toques el
organigrama»*): en «Pendientes del equipo» sigue mandando él, y ahí el agrupador no se pinta
—no hay lista que agrupar—. `git diff` de `vista-organigrama.*` **vacío**, y hay un escenario
del arnés que lo exige, no que lo suponga.

**Tres decisiones que no son de estilo:**

- **La tarjeta de una persona dentro de un bloque cuenta SOLO lo de ese sitio.** Hay Encargadas
  con su tienda más MANTENIMIENTO y SISTEMAS en la ficha (15/sep), así que una misma persona
  aparece en dos bloques. Si su tarjeta contara todo lo suyo, el bloque de «La Piedad Abastos»
  diría «9 tareas · 56%» mezclando otra sucursal: un número sin su coordenada (§5.7), que es
  **el defecto del denominador inflado de septiembre por otra puerta**.
- **Las tareas sin `store` son un bloque propio y visible, al final.** Descartarlas habría
  hecho cuadrar los totales y desaparecer gente de la pantalla, que es exactamente lo que
  produce el hallazgo 1.
- **Con un solo grupo el encabezado no se pinta** —diría siempre lo mismo—, salvo que ese único
  grupo sea el de «Sin sucursal»: un dato que falta, callado, es un dato que nadie arregla.

**Y la clave de agrupación va normalizada mientras se pinta el texto original.** La sucursal
sale de `store`, que es texto libre: sin eso, «Yurécuaro» y «yurecuaro » serían **dos
encabezados con el mismo nombre** y se leería como que la app duplicó la sucursal. No arregla
el hallazgo 1; lo contiene hasta la Fase 3.

#### EL CACHE NO ES OPTIMIZACIÓN PREMATURA: ES LA CAÍDA DEL 1/SEP

Los dos getters de grupos construyen un arreglo. Sin cache por huella, el `*ngFor` recibiría
uno **nuevo** en cada ciclo de detección y destruiría y recrearía la lista entera —con cuatro
polls y cada respuesta HTTP disparando uno—. Es literalmente `menuDe()` del sidebar. Con la
huella, el `*ngFor` recibe el MISMO arreglo y no hace nada.

#### LAS PRUEBAS, Y EL CONTROL NEGATIVO QUE AFIRMA EL MECANISMO

**294 de 294** unitarias (18 nuevas) más `scripts/prueba-buscador-y-agrupacion.js`, **6
escenarios en el DOM**:

    escenario                             tarjetas  de PH  de LPA  encSuc  btn  árbol
    enviadas equipo, sin buscar           3         2      1       2       1    0
    enviadas equipo + «la piedad abastos» 1         0      1       0       1    0   <- LA CAPTURA
    pendientes equipo (árbol intacto)     0         0      0       0       0    1
    mis pendientes, sin buscar            3         2      1       2       1    0
    mis pendientes + «la piedad abastos»  1         0      1       0       1    0
    mis pendientes + «anden» (sin acento) 1         0      1       0       1    0

**No se cuentan tarjetas: se cuenta DE QUÉ SUCURSAL son las que quedan** (§8.11 b). «Hay menos
tarjetas» lo pasa un filtro que borre al azar; `dePH: 2 → 0` es el mecanismo.

| | qué se rompió (una línea, `diff` comprobado) | qué pasó |
|---|---|---|
| NEG-1 | el historial deja de llamar al filtro | 4 rotas, y **reproduce la captura literal**: «quedaron 2 de Padre Hidalgo». Y **solo cae ese camino** — «mis pendientes» sigue filtrando |
| NEG-2 | la agrupación ignora la sucursal (clave fija) | **aborta con código 3** por falta de discriminación… **con las tarjetas todavía correctas**: un control que solo mirara tarjetas habría dado VERDE |

**Y una guardia que cazó un no-op antes de que concluyera nada:** el arnés escribe en el
buscador real y **comprueba que el valor quedó en el input**. Fijar `.value` sin disparar
`input` no avisa a `ngModel`, así que la medición saldría como si nadie hubiera escrito — un
no-op que da verde, que es peor que fallar.

#### DOS DEFECTOS MÍOS, Y LOS DOS ESTABAN YA ESCRITOS EN ESTE ARCHIVO

1. **La primera corrida dio `dePH: 0` en TODAS las filas**, incluidas las que no buscaban —que
   se lee como «la app no pinta la sucursal»—. No era la app: había añadido la clase medible
   **después** del `ng build`, así que el arnés servía un `dist/` sin ella. *«Después de
   restaurar un archivo, reconstruir»* (1/sep), y vale igual para «después de editarlo». El
   resto de columnas estaba bien, que es lo que lo hizo evidente: si hubieran fallado todas,
   habría ido a depurar la app.
2. **El heredoc se rompió con las comillas anidadas del arnés** — quinta vez en este repo. No
   dejó archivo a medias (abortó antes), pero la salida es la de siempre: una herramienta que
   no interprete el contenido.

Y una que no es defecto pero conviene anotar: **`diff` salió entero por CRLF/LF** en los
controles negativos. El repo sigue sin `.gitattributes`. Se comprobó con `--strip-trailing-cr`
que el cambio real era **de una línea**, y que el commit no arrastra finales de línea
(`--numstat`: 465 añadidas, 37 quitadas, sin explosión).

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **NADIE HA ENTRADO CON UNA CUENTA REAL.** Los seis escenarios son sesiones sintéticas en
  Chrome headless. Que el buscador recorte está probado; que se **vea** bien, no.
- **El contador va a bajar al teclear, y eso es la corrección, no tareas perdidas.** Por eso
  ahora dice «N de M» cuando hay búsqueda activa, y el vacío distingue «no hay historial» de
  «tu búsqueda no encontró nada dentro de él» — dos frases que con un solo mensaje llevan a
  concluir que esas tareas nunca se enviaron.
- **No arregla el hallazgo 1**, lo contiene: dos capturas de la misma sucursal que difieran en
  algo más que tildes, espacios o puntuación siguen siendo dos bloques.
- **El panel de responsables sigue muerto**, con o sin este cambio. Reactivarlo o enterrarlo es
  decisión de David.
- **No mueve ningún número de tablero ni ninguna fase del plan.** Cero migraciones, cero
  escrituras, y el organigrama intacto.

### 15/sep/2026 (madrugada) — EL RELOJ A LAS 00:00, Y DOS DEFECTOS QUE ENCONTRARON OTROS

La primera prueba real del emisor de anoche llegó sola, a las 00:01:

    [emisor-manual] 2026-09-15: 235 creada(s), 0 ya estaban, 0 fallida(s), de 154 fichas
    [emisor-manual] sin tareas hoy: 87 persona(s) — 20: sin puesto del organigrama | 11: el
    puesto "Auxiliar de Encargado" aún no tiene manual | 4: "Analista de Órdenes de Entrada" | …

**235 documentos sin que nadie abriera la app**, y de paso el mejor censo que tiene el proyecto:
**87 personas sin una sola tarea, cada una con su motivo**, ordenado por a cuánta gente afecta. La
sesión de la Fase 7 lo usó para **corregir su lista de prioridades**: su cifra salía de la nómina
de agosto y decía que el primero era `vendedor-rd` (11); la base dice `auxiliar-encargado` (11
contra 5 de la nómina) y `vendedor-rd` baja a 4. Las dos mediciones son correctas sobre
poblaciones distintas, y la que decide a quién escribirle el manual primero es la de la base,
porque es la que tiene gente entrando a la app.

#### EL RELOJ: ANCLADO A MEDIANOCHE, NO AL DESPLIEGUE

David: *«si el día inicia a las 12 a.m., a las 12 a.m. tienen que estar ya activadas»*. Las 235
salieron a las 00:01 **por casualidad**: otra sesión desplegó justo entonces y el contenedor
reinició ahí. El `setInterval` se anclaba al **arranque**, así que con el despliegue de las 23:16
las vueltas caían en :16, :26, :36. Bajar el intervalo estrecha la ventana pero **no la ancla**:
la hora a la que la gente ve sus tareas seguiría dependiendo de a qué hora se desplegó por última
vez, y eso no se le puede explicar a nadie.

**UN SOLO RELOJ PARA DOS TRABAJOS.** El cierre del día (23:59) y la emisión del nuevo (00:00) son
la MISMA frontera con un minuto de diferencia. Con dos temporizadores, un contenedor que reinicie
entre los dos deja el día **cerrado y sin emitir** o **emitido y sin cerrar**, y desde fuera se
ven igual. Van en orden en la misma vuelta, las dos idempotentes, así que un reinicio a cualquier
hora recupera las dos mitades. `cerrarDia` lo escribe otra sesión en su módulo; si no está, esto
emite igual.

**El colchón de 5 s no es superstición:** `setTimeout` puede despertar unos ms ANTES de la hora
pedida, y entonces la fecha calculada sería todavía la de ayer — se emitiría otra vez el día que
acaba de terminar.

**Y no se prueba esperando.** Un caso que tardara hasta 24 h en correr no se correría nunca, así
que las tres piezas son funciones puras. **20 afirmaciones**, `ayerDe` probado en primero de mes,
primero de año y 1 de marzo bisiesto y no bisiesto, más la guardia de que **el reloj AVANZA** —sin
ella, un `msHastaMedianoche` que devolviera una constante pasaría todo lo demás—.

#### DOS DEFECTOS MÍOS QUE ENCONTRARON OTRAS SESIONES, y los dos eran silenciosos

**1 · EL `await cerrarDia(...)` NO LLEVABA TOPE.** Lo vio `a3` revisando el enganche. Mi
try/catch solo cubre lo que **lanza**; un cuelgue no lanza —una consulta que no vuelve, un pool
agotado, un lock— y como el cierre corre ANTES de emitir, ese `await` habría dejado a 186 personas
sin tareas ese día, **en silencio y sin una línea en el log**. No hace falta un bug del cierre:
basta la base lenta a esa hora. Es el cuelgue del login del 1/sep con otra ropa.

La guardia va del lado del **que llama**: un tope dentro del módulo de cierre no protege del caso
en que lo que se atasca sea el propio módulo antes de llegar a él. El peor caso queda en «un día
sin cerrar», que la vuelta siguiente recupera, en vez de «un día sin emitir», que no.

**Y escribir esa prueba destapó un segundo defecto, mío también:** `cambioDeDia` devolvía **sin
hacer nada y sin log** cuando la regla compilada no estaba cargada, y solo funcionaba porque
`iniciarPoll` llamaba a `cargarRegla()` unas líneas más arriba. Un accidente de orden, no una
garantía. Es la misma clase que la guardia del despliegue que acertó «de milagro por ocho líneas
de orden de impresión»: **un comportamiento correcto por accidente se lee igual que uno correcto
por diseño, hasta el día que alguien mueve una llamada.**

**El tope se lee en CADA llamada, no al cargar el módulo.** Congelado en un `const`, la prueba del
cuelgue tardaba **60 segundos reales**; ahora tarda **226 ms**. Una prueba de un minuto es una
prueba que nadie corre, y una que nadie corre es una que no existe.

#### 2 · EL MANUAL SE ENTREGABA UNA VEZ POR CADA ÁREA DE LA FICHA

Lo encontró `7d` con una captura de David: «Mis tareas pendientes **9**», con tres tarjetas
repetidas tres veces. No eran duplicados de escritura — el bucle recorre `sucursales[]` entera, y
esa Encargada lleva `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`. Su manual son 3 tareas → **3 × 3 =
9**. El daño no es visual: **su denominador se triplicaba**, así que alguien que cumplió todo
aparecía al 33%.

Su arreglo —entregar solo en los sitios **con cuadrilla**, con caída a uno cuando ninguno lo es—
lo verifiqué por mi cuenta antes de desplegarlo: **9 → 3**, y RH/FINANZAS **no se quedan en cero**
(el 84% del organigrama no es de sucursal; sin esa caída el «arreglo» les habría quitado todas sus
tareas, que es un desastre peor y más silencioso).

**Y tenía un borde que es la misma falla en pequeño.** La caída elegía «el primero de los suyos»,
y **el lugar entra en `idemKey`**:

    orden 1 (RH, FINANZAS):  man_encargado_sucursal_apertura_2026-9-14_rh_encargada_x
    orden 2 (FINANZAS, RH):  man_encargado_sucursal_apertura_2026-9-14_finanzas_encargada_x

Reordenar una ficha —al reeditarla en Personal, o porque un script reescriba su `datos`, y anoche
había scripts haciendo exactamente eso— habría creado un **segundo documento** para la misma tarea
del mismo día. Ahora se ordena: cuál gane sigue siendo arbitrario, pero **arbitrario y estable no
es lo mismo que arbitrario y dependiente del orden**. Es el `order by` de la siembra de plazas del
9/sep otra vez.

**Los `recortes` se registran en su propia línea**, aparte de las omisiones, porque son otra cosa:
esta gente SÍ recibe, solo que en menos sitios. Un recorte mudo se lee como un bug — quien mañana
pase de nueve tarjetas a tres va a reportar «se perdieron mis tareas».

**Aviso que hay que dar antes de que alguien lo lea mal:** las **235** de anoche **incluían las
copias infladas**. El número de mañana va a ser MENOR, y eso es la corrección funcionando, no
tareas perdidas.

#### Y LAS REPETIDAS QUE YA EXISTÍAN: 78 copias de más, de 18 personas

`lugaresDeEmision` impide que nazcan nuevas, pero las de hoy nacieron a las 00:01, **antes** del
arreglo, y seguían inflando denominadores. David: *«hay muchas repetidas, elimina las que estén
repetidas, revisa a cada usuario»*. Y después: *«arréglalo y súbelo a producción»*.

**LA DECISIÓN DE DISEÑO FUE DÓNDE PONERLA, y salió de esa segunda frase.** Lo primero que
escribí fue un script a mano… que solo puede correr quien tiene la `DATABASE_URL`. Eso no es
«subirlo a producción»: es dejarle a David una tarea. La limpieza se movió al emisor y corre en
la vuelta de **arranque**, así que **el propio despliegue la aplica** y no hace falta que ninguna
credencial pase por ningún lado.

**Y la decisión no vive ni en el emisor ni en el script:** `planDeLimpieza` está en el MISMO
archivo que `lugaresDeEmision`. Si la limpieza tuviera su propio criterio de qué sitio vale,
**borraría justo lo que la emisión vuelve a crear diez minutos después**. Las dos preguntas
—«¿dónde se entrega?» y «¿qué sobra?»— las contesta una sola función. El script se reescribió
para llamarla también; se queda para la reversa y para días pasados, que el servidor no toca.

**LAS GUARDAS, Y CUÁL ES LA QUE IMPORTA.** De todas, la que de verdad protege es que **no se toca
nada trabajado**: el resto puede equivocarse y lo peor es que sobre una tarjeta; si esa falla, se
destruye el turno de una persona. Son 12 señales, probadas **una por una** —basta que falle una
para que ese caso se borre sin que nadie lo note—, incluido **un monto de 0**, que es un arqueo
que dio cero y no un campo vacío.

Las demás: soft-delete con el rastro del id conservado (nunca un `delete`); solo `man_`, solo de
hoy en adelante, solo vivas; **nunca una asignada a mano** (`_asignadoAMano` — alguien la puso en
ese sitio a propósito, y borrarla sería deshacer su decisión con un criterio pensado para las del
robot: el sello de otra sesión acabó siendo una de mis guardas); **nunca un grupo donde no
sobreviva ninguna** (la persona se quedaría sin la tarea, que es peor que la copia de más); una
entrega sola no se toca jamás; 0 fichas leídas **cancela** la limpieza. Va **después** de emitir,
para que la conservada exista con seguridad, y solo en arranque y medianoche: un proceso que borra
no tiene por qué correr seis veces por hora.

**Y LA REVERSA ALCANZA LAS DOS VÍAS.** El script busca la marca `_repetidaPorArea`, que es la
misma que escribe el servidor, así que `--revertir --aplicar` deshace también lo que hizo el
despliegue. Comprobado antes de subir, no supuesto.

**DESPLEGADO Y MEDIDO:**

    [emisor-manual] arranca. Ahora en America/Mexico_City: 2026-09-15 04:53
    [emisor-manual] repetidas quitadas: 78 copia(s) de mas de 18 persona(s)

Ninguna línea de conflicto en esa ventana de **13 líneas** — a las 04:53 nadie había trabajado
todavía, que es justo cuando esta limpieza es más barata. **27 afirmaciones** en su arnés (el caso
exacto de la captura: 3 copias → quita 2, conserva 8 Esquinas) y de punta a punta contra base
simulada: **9 → 3 vivas, 6 marcadas**. 255 de Angular.

**Lo que esto NO prueba, dicho para que no se lea de más:** que las 78 fueran exactamente las que
sobraban. Lo que está probado es el mecanismo —la regla que las eligió es la misma que decide
dónde se entrega— y que nada trabajado entró en el conteo. **Nadie ha abierto la app con una
cuenta real** para ver las tres tarjetas de Veronica en lugar de nueve.

**Y un número que hay que decir antes de que alguien lo lea al revés:** las **235** de las 00:01
incluían esas 78. El total de hoy baja a ~157, y **eso es la corrección, no tareas perdidas**.

#### UNA PISADA DE COMMIT, Y LA REGLA QUE NINGUNA DE LAS DOS ESCRITAS CUBRÍA

El commit `771bedb` de otra sesión se llevó mi `sort` sin commitear, con un mensaje que no lo
menciona. Lo que deja, y es nuevo: **«rutas explícitas» (31/ago) y «revisar todos los archivos del
commit» (4/sep) fallan cuando dos sesiones editan el MISMO archivo.** Se agrega una ruta
explícita, se revisa por nombre, y aun así se arrastra trabajo ajeno porque está *dentro* de un
archivo que sí era propio. Lo que hay que mirar es el **diff de lo que se va a commitear**
(`git diff --cached`), no `git status`.

#### Y UN RESPALDO CON HASHES SUELTO EN LA RAÍZ

`respaldo-duplicados-*.json`: 4405 bytes con nombres de personas y el espejo de contraseña,
**sin rastrear**, apareciendo en cada `git status` a un `git add -A` de quedar commiteado para
siempre. El `.gitignore` cubría `respaldo-privilegios-*.json` y no el de al lado. **Una regla que
cubre un patrón y no el vecino es peor que ninguna: da la impresión de que el caso está
atendido.** Comprobado en las tres direcciones —el nuevo se ignora, el viejo sigue cubierto, y un
`.json` cualquiera NO— para que la regla no se volviera tan ancha que tapara ficheros legítimos.

#### DESPLEGADO

    bundle  2 marcadores nuevos servidos, 26 controles en pie, 65 archivos / 4.48 MB
    log     [emisor-manual] arranca. Ahora en America/Mexico_City: 2026-09-15 04:32
            siguiente cambio de día en 1168 min (a las 00:00 de America/Mexico_City)

**255 pruebas** (219 → 255), más 16 afirmaciones del emisor y 20 del reloj. Cuatro controles
negativos, una línea cada uno con su `diff`.

**Lo que NO se puede verificar desde fuera, dicho de antemano:** el tope del cierre es una ruta
muerta hasta que exista `api/cerrar-dia.js`, así que el log de arranque es idéntico con y sin él.
Lo comprobado es que el árbol estaba limpio al subir y que el commit es ancestro de lo desplegado.
La primera prueba real será la línea `cierre de … : N cerrados`.

### 15/sep/2026 — DOS CORRECCIONES AJENAS SOBRE LO MISMO, Y UNA ES DE PROCESO

**1 · MI CAÍDA ERA ARBITRARIA *Y* INESTABLE, que no es lo mismo.** `lugaresDeEmision` caía a
«el primero de los suyos» con `slice(0, 1)`. Otra sesión midió lo que eso significa, y el dato es
el que lo condena — **el lugar entra en `idemKey`**:

    orden 1 (RH, FINANZAS):  man_..._2026-9-14_rh_encargada_x
    orden 2 (FINANZAS, RH):  man_..._2026-9-14_finanzas_encargada_x

O sea que si la ficha de alguien se reordenara —al reeditarla en Personal, o porque un script
reescriba su `datos`, **y ahora mismo hay scripts haciendo justo eso**— la misma tarea del mismo
día saldría con otro id y se crearía un **segundo documento**. El denominador que este arreglo
vino a desinflar volvía a inflarse por la puerta de al lado.

Corregido con un `sort` antes del `slice`. Cuál gane sigue siendo arbitrario —la ficha no dice
cuál de sus áreas es «la suya»— pero **arbitrario y estable no es lo mismo que arbitrario y
dependiente del orden**. Es, literalmente, el `order by` que le faltaba a la siembra de plazas
del 9/sep: «el slot no significa nada, y aun así tiene que ser reproducible».

**2 · Y LA DE PROCESO, QUE ES MÍA.** Mi commit `771bedb` se llevó ese `sort` cuando todavía
estaba sin commitear en el árbol, y su mensaje no lo menciona: quien lea ese commit dentro de
tres meses no encuentra ahí el porqué. El motivo vive en `a561ccb`, aparte.

**Lo que esto añade a las dos reglas que ya estaban escritas, porque ninguna lo cubría:**

> El 31/ago: «siempre `git add` con rutas explícitas». El 4/sep: «revisar TODOS los archivos del
> commit, no solo los que uno sospecha». **Las dos fallan cuando dos sesiones editan el MISMO
> archivo:** yo agregué una ruta explícita, la revisé por nombre, y aun así me llevé trabajo
> ajeno que estaba dentro. Lo que hay que mirar es el **diff de cada archivo que se agrega**, no
> su nombre — `git diff --cached` antes de commitear, no `git status`.

**Lo que las dos correcciones tienen en común:** salieron de que el otro **midiera**, no de que
leyera el código. El `sort` lo destapó imprimir las dos llaves; la pisada del commit, mirar el
diff real de `771bedb`. Y las dos son la misma familia de fallo que este archivo lleva un mes
registrando: algo que «funciona» porque hoy el orden ayuda.

### 15/sep/2026 — «HAY MÓDULOS REPETIDOS»: el manual se entregaba una vez por ÁREA

David, mirando su pantalla: *«hay módulos repetidos»*, sobre una captura de
**«Mis tareas pendientes 9»** con las mismas tres tarjetas tres veces. Y después:
*«quiero que revises en todos los usuarios que no hayan módulos repetidos»*.

**NO ESTABAN DUPLICADAS: ESTABAN EMITIDAS TRES VECES, UNA POR LUGAR.** La ficha de esa Encargada
lleva `8 Esquinas`, `MANTENIMIENTO` y `SISTEMAS`, y el emisor recorría esa lista entera
entregando el manual completo en cada entrada. Su manual son **3 tareas**: 3 × 3 = **las 9 de la
captura**.

**Y EL DAÑO NO ES VER TRES TARJETAS IGUALES: ES EL DENOMINADOR.** Con 3 hechas de 9 emitidas,
alguien que cumplió **todo** su manual aparece al **33%**. Un número así no se lee como un
defecto de la app — se lee como una persona que no trabaja. Es el invariante §5.7 (todo número
lleva su coordenada) roto por la puerta más tonta: el lugar.

#### LA CAUSA ES EL HALLAZGO 1 EN SU FORMA MÁS CARA: UN CAMPO QUE SIGNIFICA DOS COSAS

`sucursales[]` dice **dónde trabaja alguien** Y **a qué áreas tiene acceso**, y la ficha no los
distingue. MANTENIMIENTO y SISTEMAS están ahí para que pueda levantar un ticket, no porque abra
una tienda. Mientras nadie cruzara esa lista con la emisión, la ambigüedad no costaba nada.

**La regla nueva (`lugaresDeEmision`) no inventa un criterio:** usa `tieneCuadrilla()`, que ya
existía y salió de una instrucción del propio David sobre el pase de lista — «quítale esas dos»,
MANTENIMIENTO y SISTEMAS. Una sola definición para dos preguntas que son la misma.

**⚠ LA RED DE SEGURIDAD ES LA MITAD DEL ARREGLO.** El **84%** del organigrama no es de sucursal:
RH, FINANZAS, COMPRAS, MKT y CONTABILIDAD tienen como único sitio un área. Filtrar a secas les
habría quitado **todas** sus tareas — cambiar un denominador inflado por un cero es peor y más
mudo. Si alguien no tiene ningún lugar con cuadrilla, se le entrega **una vez en el primero de
los suyos**. La propiedad que deja, y es lo que permitió desplegar sin medir antes a quién
afecta: **esto solo puede quitar copias de más; nunca deja a nadie en cero.**

#### EL MARCADOR NO EXISTÍA, Y BUSCARLO DESTAPÓ LO QUE FALTABA

Un cambio de lógica pura no introduce ninguna cadena propia. Se comprobó **midiendo**, no
suponiendo: con el arreglo ya compilado, los **26 marcadores daban el mismo número en `dist/` y
en producción**. O sea que el despliegue habría sido inverificable.

El marcador honesto acabó siendo **una línea que hacía falta igual**: el recorte era **mudo**.
Si a alguien dejan de salirle sus tareas en MANTENIMIENTO, la pregunta «¿por qué ya no me salen?»
no tenía respuesta en ningún sitio. Ahora el plan devuelve `recortes` —con nombre y los lugares
quitados— aparte de `omitidos`, porque esta gente **sí recibe**: confundirlos sería decir que no
recibió nada. Es la tercera vez que elegir un marcador destapa algo que no se venía a buscar.

#### LO QUE CONTESTA «EN TODOS LOS USUARIOS», Y LO QUE NO

`scripts/diagnostico-entregas-repetidas.js` (nuevo, **solo lee**) contesta las dos mitades:

- **El modelo:** de las fichas activas, a cuántas se les entregaba de más y cuántas entregas al
  día son. Con sus denominadores: cuántas fichas se leyeron, cuántas reciben manual.
- **El hecho:** los duplicados **ya escritos** — misma persona, misma tarea, mismo día, en dos
  sitios— de los últimos 7 días, sobre el total de checklists de manual de la semana.

Los dos hay que mirarlos: el modelo puede estar bien y la base traer lo de antes. **No borra
nada** a propósito: algunas de esas copias pueden estar contestadas, y borrar evidencia de
alguien es lo que el §5.5 prohíbe hacer sin decidirlo con la lista enfrente. Aborta sin
`DATABASE_URL` (probado: código 3) y aborta con cero fichas o cero checklists, porque con la app
en producción eso no es «no hay»: es «no leí».

**Lo más importante para no malinterpretar el resultado: las 9 de la captura NO desaparecen.** La
regla gobierna lo que se emite **desde ahora**; lo ya escrito sigue ahí hasta que se decida qué
hacer con ello. Si mañana siguen saliendo 9, el arreglo no falló: son las de hoy.


### 15/sep/2026 — LA NORMA BAJA A DATO (Fase 7 · paso 7.1a), y la premisa era falsa

Instrucción de David: *«quiero que todos los puestos tengan sus tareas propias activas»*, y
aclarando en el mismo turno: *«que todas se activen por día, me refiero a las tareas de manual»*.
Más una tercera, que acabó siendo la que dio forma al paso: *«revisa estrictamente que ninguna
tarea se repita»*.

**LO PRIMERO QUE MEDÍ DESMINTIÓ LA PREMISA, y ésa es la mitad útil del día.** Simulando la regla
real (`planDeEntregas`) para los 7 días con un usuario por puesto:

    18 de los 19 puestos con manual YA reciben tareas TODOS LOS DIAS
    anaquelista 18 pts/dia · encargado-sucursal 23 · cajero-sucursal 23 · checador 28

No había nada que «activar» ahí. El único puesto con manual que se queda en blanco es
`aux-logistica-flotilla` —5 de 7 días—, y no es un fallo: sus 3 tareas son 2 semanales y 1
mensual. **Si David veía 0 en pantalla, el catálogo no era la causa** — eso es la emisión, y esa
pregunta sigue sin contestar (ver abajo).

**DÓNDE ESTABA EL PROBLEMA DE VERDAD, con su denominador:**

    19 de 89 puestos tienen manual escrito  ·  70 no lo tienen
    38 de esos 70 TIENEN GENTE
    104 de 191 personas (54%) tienen un puesto SIN manual   <- mas que las que si

    11 vendedor-rd · 10 surtidor-zona · 6 promotora · 6 chofer-cedis
     6 auxiliar-chofer · 5 auxiliar-encargado · 5 vendedor-vecinal

Más gente sin manual que con manual. A esas 104 personas **no se les puede «activar» nada porque
no existe el documento**, y escribírselo desde el código habría sido inventarles obligaciones
(§8.5) con un despliegue por cada corrección (hallazgo 5).

> **CORRECCIÓN EL MISMO DÍA (§8.11 f) — ESA LISTA SALE DE LA NÓMINA, Y LA BASE DICE OTRA COSA.**
> Las cifras de arriba cruzan `nomina-puestos.ts` (la nómina de **agosto**, 191 filas) contra el
> catálogo. El emisor del servidor —puesto anoche por otra sesión— publica el censo **real** en
> el log de Railway, y a las **00:01 del 15/sep** dijo, medido sobre **154 fichas**:
>
>     235 creada(s), 0 ya estaban, 0 fallida(s), de 154 fichas
>     sin tareas hoy: 87 persona(s) — 20 sin puesto del organigrama + el resto sin manual
>
>     11 Auxiliar de Encargado     4 Analista de Ordenes de Entrada   4 Surtidor de Zona
>      4 Vendedor Ruta Directa     3 Analista de Egresos              3 Aux. Mercadotecnia Zona
>      3 Direccion General         3 Servicios al Personal            2 Promotora
>
> **El orden se invierte donde más importa:** `auxiliar-encargado` pasa de 5 (nómina) a **11**
> (base) y es el primero de la fila; `vendedor-rd` baja de 11 a **4** y `chofer-cedis` no aparece.
> Las dos mediciones son correctas sobre poblaciones distintas —191 de nómina contra 154 fichas
> activas— pero **la que decide a qué puesto escribirle primero es la de la base**, porque es la
> que tiene gente entrando a la app. Verificado leyendo el log directamente, no tomado de palabra.
>
> Y de paso contesta lo que este mismo apartado daba por pendiente: **el emisor SÍ está
> emitiendo**, 235 documentos sin que nadie abriera la app. El 0 que David vio el 14/sep no se
> ha explicado todavía, pero hoy no se repitió.

**LAS DOS DECISIONES DE DAVID, enfrentado a las opciones con su precio:** la norma de los puestos
sin manual **se captura desde la app** (esto), y las **10 tareas no diarias del catálogo se
respetan** —volverlas diarias habría hecho que el inventario mensual de flotilla del día 25 se
cobrara ~30 veces al mes, multiplicando por 30 el denominador de esa persona—.

#### «QUE NINGUNA TAREA SE REPITA» SON SEIS COMPROBACIONES, NO UNA

Medido sobre el catálogo en código, que está **limpio en las seis**:

| clase | resultado |
|---|---|
| ids de tarea duplicados | 0 |
| un puesto con dos manuales | 0 |
| punto repetido dentro de una tarea | 0 |
| mismo punto en dos tareas diarias del mismo puesto | 0 |
| nombre de tarea repetido en un puesto | 0 |
| código de formato repetido **dentro de su documento** | 0 |

**Cinco ceros seguidos son sospechosos de no medir nada**, así que el chequeo lleva control
positivo: sembrando un duplicado de cada clase, las cuatro cuentas suben (`ids 0→1`,
`puntoEnTarea 0→1`, `puntoEnPuestoDiario 0→9`, `nombreEnPuesto 0→1`). Discrimina, así que los
ceros valen.

**Dos falsos positivos de mi propio chequeo, y los dos instructivos.** El primero: los códigos
«Anexo A» aparecían en 7 tareas y parecían duplicados — **cada manual tiene su propio Anexo A**,
así que la unicidad es *dentro del documento*, no global. El segundo es peor y es un hueco de
cobertura: mi chequeo de ids recorría **manuales**, no puestos, así que **no podía ver** que un
manual compartido por dos puestos entrega tareas con el mismo id. Al medirlo bien aparece la
única repetición real: las **3 tareas del Checador (28 puntos)** llegan a `checador`
(operaciones-zona) y `checador-cedis` (cedis). No se duplican para nadie —cada persona recibe la
suya una vez— pero **al sumar por puesto esos 28 puntos se cuentan dos veces, en dos unidades
distintas**. Ya estaba anotado el 4/sep; lo resuelve «una plaza, un solo padre» (Fase 6).

#### LOS CANDADOS VIVEN EN LA TABLA, NO EN EL ENDPOINT

Misma decisión que `tmp-%` en la 057, y por el mismo motivo: un candado en el handler queda a
merced del siguiente camino de escritura que alguien abra.

- **`check (id like 'tp-%')`** — una tarea capturada **no puede pisar el id de una publicada**.
  Importa más de lo que parece: la llave de idempotencia es
  `man_<tareaId>_<periodo>_<sucursal>_<persona>`, así que dos tareas con el mismo id producirían
  **la misma llave** y una pisaría a la otra en silencio.
- **Único por `(puesto_id, lower(trim(nombre)))` donde vigente.** Sobre `lower(trim(...))` porque
  **el duplicado real no llega escrito idéntico**: llega como «Apertura» contra «apertura ». Es
  el hallazgo 1 entrando por esta puerta. Parcial, para que las versiones retiradas convivan.
- **La frecuencia no puede quedar a medias.** Una Semanal sin día y una Mensual sin día del mes
  **no se emiten nunca**, y eso se ve idéntico a «esa persona no tiene nada que hacer» (§5.2).

**Y el endpoint no es un CRUD pelado.** El factory da POST-que-sobrescribe y DELETE físico, y los
dos están mal en una norma: editar en el sitio una regla ya emitida hace imposible saber con qué
versión se juzgó un día pasado (§5.4), y borrar deja huérfanos los checklists emitidos (§5.5).
Los dos se cierran, y el **PATCH va con lista BLANCA de tres campos** — si pudiera tocar `items`,
el candado del POST sería decorativo: se editaría la norma por la otra puerta. La lista es blanca
y no negra para que **una columna nueva nazca cerrada**.

**Un punto repetido en DOS tareas AVISA y no bloquea**, y la distinción es de diseño: «Caja
limpia» en apertura y en cierre es correcto —se verifica dos veces al día—. Bloquearlo obligaría
a quien captura a deformar el texto para esquivar la validación, que es peor que el duplicado.

#### `api.guardar` SE TRAGA EL FALLO, y aquí eso habría sido lo peor posible

La pantalla usa `api.post`, no el helper. `api.guardar` registra en consola y **vuelve sin
lanzar**, así que con él la pantalla diría «guardada» aunque el servidor la hubiera rechazado — y
aquí el rechazo es justo lo que más importa: el **409** del candado anti-duplicado. Quien captura
se iría convencido y la tarea no existiría. Es el **defecto #1 del 14/sep**, cobrado en otra
pantalla un día después.

#### LAS PRUEBAS, Y TRES CONTROLES NEGATIVOS QUE NOMBRAN EL MECANISMO

**247 de 247** (28 nuevas). Los dos del util, **una línea cada uno** (331 → 331, `diff`
comprobado), y lo que los hace válidos es que **no tumban la suite**:

| | qué se rompió | qué cayó |
|---|---|---|
| NEG-1 | comparación literal en vez de normalizada | **exactamente las 2** que dependen de la normalización |
| NEG-2 | `declaradasDePuesto` ignora `vigente` | **exactamente las 2** de vigencia |

**`scripts/prueba-captura-norma.js` (nuevo)** contesta lo que ninguna prueba unitaria puede:
**quién tiene el botón delante**, porque un `*ngIf` no es una función que se pueda llamar.

    sesión         hoja  detalles  sección-propias  botón-nueva  pidió /api
    dueno            11         1                1            1        true
    adminGlobal      11         1                1            1        true
    encargada        11         1                0            0        true   <- ENTRA y no escribe

**La Encargada es la fila que hace válidas a las otras dos.** Control negativo: abierto el gate a
todos, caza la fuga **nombrando el perfil** y además dispara la guardia de discriminación (3 de 3
ven el botón), con código 2.

**Y su guardia de «¿pidió /api?» cazó un defecto mío antes de que concluyera nada:** el gate ya
discriminaba (1/1/0) pero la petición **nunca salía** — `ApiService.token()` sin sesión. Se
siembra `md_token`, que es el camino legítimo del producto desde el acceso por plaza. Sin esa
guardia, la tabla habría dado verde sobre una pantalla que no leía la norma.

**Y repetí dos defectos que ya estaban escritos en este archivo**, lo cual dice algo sobre
releerlo: el `%-10s` de printf que Node no soporta (7/sep) y un `\Q...\E` dentro de `grep -E`,
que no lo soporta — este último **reportó 7 tokens CSS como inexistentes cuando los 7 existen**.
Rehecho con control positivo y negativo: **121 tokens declarados, 15 usados, 0 faltantes**.

**Y un cero mío que no era un cero.** La primera simulación de los 7 días dio **133 ceros
perfectos**, que se leen como «la regla no emite nada». Era mi script leyendo `e.checklist.items`
donde el campo es `e.payload`. Lo delató **el canario de `compilar-manual.js`**, que produce
entregas con esa misma entrada: sin él habría ido a depurar una regla intacta. §8.11(a) literal.

#### DESPLEGADO Y VERIFICADO — las tres mitades, que no son la misma

    marcador ... mp-propias 0 -> servido · 26 controles en pie · 66 archivos · 4.48 MB
    migracion .. [migrate][sql] 060 · tareas de puesto: 0 filas (0 vigentes) en 0 puesto(s)
                 [migrate] aplicada: 060_tareas_de_puesto.sql
    endpoint ... GET  /api/tareas-puesto -> 401 «Falta Authorization Bearer token» (montado)
                 DELETE                  -> 405 «no se borra: se retira con vigente=false»

Los ceros de la migración **se declararon ANTES de desplegar**, dentro de la propia migración, y
el notice sirve de control positivo **por su mecanismo**: sale de tres `count(*)`, así que no
puede imprimirse si la tabla no existe. El bundle creció de 4.43 a 4.48 MB, coherente con código
nuevo. La espera usó la guardia buena —rótulo `status:`, línea completa— y vio `Building`,
`Deploying` y `● Online` en **4 esperas**.

**`git push` VOLVIÓ A FUNCIONAR.** El bloqueo del 13/sep (`Repository not found`, cuenta
`dev-david24` contra el remoto `IngeDavid2209`) ya no existe: `HEAD == origin/main` en `bf78417`.
Los 39 commits que vivían solo en esta laptop están arriba, así que **los workflows programados
vuelven a ser gobernables** (§1: para Actions, `git push` SÍ es el despliegue).

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **NO ENTREGA UNA SOLA TAREA.** La tabla nace vacía y **el emisor no la lee**. Este paso crea el
  lugar donde escribir la norma y la pantalla para hacerlo; que lo capturado se entregue es
  **7.1b**, y ése sí mueve el denominador de 104 personas — no podía viajar de contrabando con
  éste.
- **Nadie ha capturado una sola tarea**, así que la sección abre vacía en los 89 puestos. Su
  primer valor aparece cuando Dirección escriba las de `vendedor-rd`.
- **No se sabe todavía por qué David vio 0** en la barra. `scripts/diagnostico-emision-hoy.js`
  sigue sin correr: necesita una `DATABASE_URL` de producción.
- **Nadie ha entrado con una cuenta real.** Las tres sesiones son sintéticas en Chrome headless.
- **La bitácora del despliegue de anoche quedó sin commitear**, en el árbol, de otra sesión. No
  se tocó: mezclarla en este commit habría sido el fallo del 4/sep. *(Luego resultó ser de la
  sesión a3, y David **había rechazado** esa edición: la herramienta le dijo que no había
  escrito y sí lo había hecho. La revirtió ella. Y de paso destapó un error mío: al restaurar el
  árbol desde una copia hecha antes, **reintroduje su bloque unos minutos** — restaurar desde una
  copia vieja es reescribir el trabajo de otro con un estado caducado.)*

#### LOS TRES AGUJEROS DE 7.1b, SEÑALADOS POR LA SESIÓN DEL EMISOR ANTES DE ESCRIBIRLO

Revisión cruzada de `mega-dulces-app-b0`, que lleva el emisor. Se anotan aquí porque **7.1b se
escribe contra esta lista**, no contra la intuición:

1. **La colisión de ids — YA CERRADO, antes de que lo señalara.** `idemKey` es
   `man_<tareaId>_<periodo>_<sucursal>_<persona>`, así que una tarea capturada que recibiera el
   id de una publicada produciría **el mismo checklist id**: el emisor crearía una, encontraría
   la otra tomada y la descartaría **en silencio**, sin que nadie supiera qué norma quedó escrita.
   Lo impide el `check (id like 'tp-%')` de la 060 (línea 91), en SQL y no por convención. Vale
   anotar que **dos sesiones llegaron por separado al mismo candado** partiendo del mismo
   razonamiento sobre `idemKey`: es la señal de que el prefijo de la 057 era la pieza correcta.

2. **LA VERSIÓN DE LA NORMA SE QUEDARÍA EN BLANCO — hallazgo real, sin resolver.** Confirmado
   leyendo el archivo, no de palabra:

       emision-manual.util.ts:424   _manualDocumento: manual?.documento || '',
                             426   _manualVersion:   manual?.version   || '',

   `manual` sale de `manualDePuesto(puestoId)`, que lee el catálogo de TypeScript. Para un puesto
   sin manual es **null**, así que los tres sellos saldrían **cadena vacía** — y el `|| ''` hace
   que eso **no falle**: el checklist se emite igual y simplemente no se puede auditar. Sería
   perder el invariante §5.4 (*«cada emisión guarda la versión con la que se juzgó»*) **por el
   camino, en el paso que viene a cumplirlo**. La fila ya trae `documento` y `version` (esta
   última `not null`, justo por esto); falta que `armarChecklist` **los prefiera cuando existan**.

3. **La regla de mezcla se decide, no se descubre.** Qué pasa si un puesto tiene manual **y**
   tareas capturadas. `tareasCombinadasDePuesto` ya decidió —**se suman**, publicadas primero— y
   `revisarTareaPuesto` **bloquea** capturar una con el mismo nombre que una publicada, así que
   el choque no puede nacer. Pero su recomendación se toma: **7.1b arranca solo por los 70 puestos
   SIN manual**, donde la tabla no compite con nada, y la mezcla espera a un caso real.

4. **Y el `omitidos` del cliente va a mentir** mientras el navegador no lea la tabla: su robot
   seguiría reportando «el puesto X aún no tiene manual» para gente que sí la tiene. No hace daño
   —la idempotencia es por id y el servidor las crea igual— pero las dos lecturas tienen que
   salir en el mismo paso.

### 14/sep/2026 (noche) — EL RELOJ DE LAS TAREAS SALE DEL NAVEGADOR

Captura de David: «Pendientes del equipo **0** · Mis tareas pendientes **0**», y su instrucción:
*«quiero que todos tengan activas sus tareas del día»*. Por la mañana esa misma barra decía 112.

**LA CAUSA, medida antes de tocar, y es peor de lo que parecía.** La emisión del manual **no
existe en el servidor**. Los cuatro polls de `server.js` son flotilla, avisos, bloques y pagos;
ninguno emite. La única emisión era `RobotManualService`, y corre **dentro del navegador** de
quien abre `/tareas` (`checklist.ts:2055`), repitiéndose cada 5 min *mientras esa pestaña siga
abierta*. O sea: **las tareas del día de 186 personas dependían de que alguien las abriera.** Es
el hallazgo 6 un peldaño más abajo — el reloj no vivía en el servidor web, vivía en un CLIENTE.

**Y un segundo hallazgo que explica por qué un cero no se repone solo:** la idempotencia lee
`/api/checklists?desde=hoy&hasta=hoy` y **esa respuesta incluye los eliminados**
(`api/checklists.js:17` deja el filtro de `eliminado` en el cliente). Un `man_…` de hoy marcado
eliminado **bloquea su propia reemisión el resto del día**. Mañana vuelve solo, porque cambia la
llave de periodo. Eso convierte un 112 → 0 en algo que ningún robot arregla ese día.

#### LO QUE SE HIZO

`src/app/shared/emision-manual.util.ts` (nuevo): la decisión, **pura**, movida tal cual desde el
service —mismos cuerpos, mismos comentarios—. `api/emitir-manual.js` (nuevo) la llama desde el
servidor cada 10 min. **No es una copia:** el navegador y el servidor invocan la MISMA
`planDeEntregas`. Dos implementaciones de «qué le toca hoy a quién» divergirían en silencio y la
misma persona tendría **dos denominadores** según quién emitiera primero (§8.11 d).

**La regla viaja compilada.** `scripts/compilar-manual.js` corre al final de `npm run build` y
emite a `dist/manual`. Hacía falta porque la imagen final **no lleva `src/` ni `tsc`**: el
Dockerfile solo copia `dist`, `server.js`, `api` y `scripts`, y la segunda etapa instala
`--omit=dev`. Va **después** de `ng build` a propósito: así no depende de saber qué borra el
builder de Angular, sino del orden, que sí se controla.

**`on conflict do nothing`, NO `do update`.** El POST de `/api/checklists` hace `do update`
porque es el guardado normal de la app. Un emisor automático no puede: corre solo cada pocos
minutos y un `do update` **sobreescribiría con items en blanco** el checklist que alguien lleva
media mañana llenando. Es la diferencia entre emitir y borrar el trabajo de la mañana.

**LA FECHA SE CALCULA EN HORA DE MÉXICO, y esto se cazó midiendo, no razonando.** El contenedor
corre en UTC. Medido en el momento de escribirlo, con el proceso en `TZ=UTC`:

    new Date() a secas ......  2026-09-15  Martes   03:00
    ahoraEnZona(Mexico) .....  2026-09-14  Lunes    21:00

O sea que **el servidor habría emitido el día equivocado esa misma noche**: las semanales caerían
en el día que no es, y las de hoy no saldrían nunca. El navegador nunca tuvo el problema porque
siempre estuvo en México.

#### EL ROBOT DEL NAVEGADOR SE MORÍA ANTES DE ESCRIBIR, Y OTRA SESIÓN LO MIDIÓ SIN QUERER

Los dos `await` del bucle iban **desnudos**: sin try/catch, la tarea 3 de 112 tumbaba las 109
restantes. Y peor, **`setDoc` no rechaza sin red: se queda pendiente**, así que la corrida podía
colgarse en la primera escritura sin un solo error en ninguna parte. Ahora cada entrega va
aislada y con `conTope`, y **primero la API**: la app lee de Postgres, así que un documento que
solo llegara a Firestore se contaría como creado y la persona seguiría sin su tarea.

**La confirmación llegó por una puerta que nadie buscó.** El arnés de otra sesión
(`prueba-catalogo-manual.js`) contaba los POST a `/api/checklists` y siempre daba 1 — porque en
headless, sin Firestore alcanzable, **el robot moría antes de escribir y sus emisiones nunca
llegaban al servidor de la prueba**. Al invertir el orden, esa misma corrida pasó a **4 POST** y
la prueba reportó siete fallos sobre un mecanismo intacto. O sea: aquella prueba dependía, sin
saberlo, de que el robot estuviera roto.

**Lo que eso NO prueba, dicho con precisión:** en producción Firestore sí es alcanzable, así que
esto no demuestra que el robot estuviera muerto para la gente. Demuestra que **el modo de fallo
es real** —y que cuando ocurre, no deja rastro—, que es justo por lo que se blindó.

#### LAS PRUEBAS, Y LOS CUATRO CONTROLES NEGATIVOS

**219 de 219** (18 nuevas) más **16 afirmaciones** del emisor contra una base simulada. Los
cuatro controles, una línea cada uno con su `diff` comprobado:

| | qué se rompió | qué pasó |
|---|---|---|
| NEG-1 | `idemKey` con un sufijo (432 → 432) | 1 falla, **nombra la llave exacta** |
| NEG-2 | la inserción pasa a `do update` (320 → 320) | 2 fallas |
| NEG-3 | se quita la guardia de cero fichas (261 → 261) | 3 fallas, y la vuelta abortada **pasa a `ok`** |
| NEG-4 | la imagen llega sin `dist/manual` | grita y **no arranca mudo** |

**El NEG-3 es el que más enseña.** Sin esa guardia, leer cero fichas —base equivocada, conexión a
medias— produce `estado: 'ok'` con «0 creadas», que es **exactamente indistinguible de un día
normal sin trabajo pendiente**. La guardia cita la cifra conocida (la 050 contó 150 activas) y
aborta la vuelta sin escribir.

**La llave quedó fijada contra un literal** en el spec, y el canario del build la vuelve a
comprobar: `man_anaquelista_pasillo_2026-9-14_canindo_ana_perez`. No es purismo — en producción
ya existen miles de documentos con esa forma, y cambiarla crearía un **segundo** documento por
cada punto ya emitido. Además comparte llave con la entrega a mano de `eca287d`, que es lo que
impide que las dos vías se dupliquen.

#### DESPLEGADO Y VERIFICADO — las dos mitades, porque no son la misma

    bundle .... los 3 marcadores nuevos servidos, 23 controles en pie, 65 archivos / 4.46 MB
    emisor .... [emisor-manual] poll iniciado (cada 10 min). Ahora en America/Mexico_City: 2026-09-14 23:16

**Un marcador en el bundle NO prueba que el emisor emita** — es un cambio de lógica y de
servidor, así que el marcador tuvo que ser una frase del texto de la regla (el minificador se
come los nombres de función, respeta los literales). La prueba del emisor es su línea en el log,
y se buscaron **las dos** cadenas, no solo la buena: `NO SE PUDO CARGAR LA REGLA` dio 0 con la
buena presente. Ventana de log citada: **11 líneas** (truncada, así que una ausencia ahí no
concluye por sí sola).

Salieron tres trabajos en un solo `railway up` —el catálogo del manual a mano (`eca287d`, que
llevaba commiteado y **nunca desplegado**) y el desglose de permisos (`a026495`)—, coordinado por
`SendMessage` con las otras dos sesiones. La guardia de espera, por fin correcta a la primera:
anclada al rótulo `status:` y comparando la línea completa. Vio `● Online · Building (27s)`,
`Deploying (2m)` y terminó en `● Online` a secas tras **5 esperas**.

#### LO QUE ESTO NO HACE, dicho para que no se lea como resuelto

- **No repone las tareas de HOY.** Si las del 14/sep fueron eliminadas, sus ids están tomados y
  el emisor no las recrea ese día. Reponerlas es marcar `eliminado = false` en producción, y eso
  no se toca sin que David lo pida (§8.6).
- **No se sabe todavía por qué hoy salió 0.** `scripts/diagnostico-emision-hoy.js` (commit
  `7b5b2b2`, solo lee) lo contesta, y **nadie lo ha corrido**: necesita una `DATABASE_URL` de
  producción. Separa las tres lecturas —nunca se emitieron / se emitieron y se borraron / existen
  y el cero es de la interfaz— y aborta si los ocho días salen en cero.
- **«Todos» no puede ser 186 personas.** **70 de 89 puestos no tienen manual escrito**, y esa
  gente sale `omitido` con su motivo. Ahora el motivo **se reporta** en el log agrupado en vez de
  tirarse, que es lo único que este paso podía hacer: escribirles un manual es Fase 7 y lo decide
  Dirección, no el código (§8.5).
- **El emisor no pasa `esDiaCerrado` ni `esSucursalAdministrativa`**: esos ganchos viven en el
  componente y dependen de datos que el servidor no tiene. Omitirlos entrega de MÁS, no de menos
  —el lado correcto del error— y queda anotado en el código. **Falta medir cuánto de más**: un
  domingo en una administrativa son tareas que nadie puede hacer y que alguien ve en rojo el
  lunes.
- **Nadie ha entrado con una cuenta real.** La primera prueba de verdad es mañana por la mañana:
  si el log dice `[emisor-manual] … N creada(s)` sin que nadie haya abierto la app, el paso
  sirvió.

### 14/sep/2026 (noche) — LOS PERMISOS DICEN QUÉ CONCEDEN, y el rol admin se desglosa

Instrucción de David, sobre una captura de los tres permisos que SÍ estaban bien explicados
(Espacio TEC, Promociones, Pagos): *«quiero que vayas a la sección de usuarios y en el apartado
de los privilegios o permisos, todos estén así, todo lo que pueda hacer un admin quiero que lo
desgloces»*.

**Y llega justo después de que los privilegios bajaran al puesto** (la entrada de abajo, misma
noche, otra sesión): con 6 administradores reducidos a 2 y 41 fichas sin banderas de gestión,
**esta pantalla es ahora el único sitio donde se vuelven a otorgar**. Lo que diga aquí es lo que
va a regir cuando alguien pida que le devuelvan un permiso.

**EL HUECO, medido antes de tocar.** Los nueve permisos de Colaborador traían **una línea
genérica** cada uno («Permite crear, editar y asignar tareas generales») y solo se pintan con rol
Colaborador. Al elegir **Administrador (Panel Total)** ese bloque **desaparece entero**: la
pantalla concedía **135 condiciones repartidas en 44 archivos** sin decir una palabra. Quien
capturaba una ficha de administrador estaba firmando en blanco.

**ES INFORMATIVO, NO SON SWITCHES, y David lo eligió con el precio enfrente.** Se le plantearon
las dos opciones: partir el rol en banderas es rescribir el modelo de acceso en esos 135 puntos,
con migración y riesgo de dejar gente fuera — Fase 3/5, no un paso de un día. Esto **hace visible
lo que ya pasa**, y no mueve el acceso de nadie.

#### LO QUE EL DESGLOSE DESTAPÓ, y nadie sabía

Escribir los textos obligó a medir bandera por bandera, y **tres de las nueve no hacen lo que su
nombre promete**:

| bandera | lo que de verdad hace hoy |
|---|---|
| `puedeCrearTareasUnicas` | **no gatea ni una pantalla ni un botón.** Sus únicos usos son la copia de banderas del dueño y `esSupervisor` |
| `puedeVerCalendario` | abre `/calendario`… que **perdió su entrada de menú**: solo se llega por liga directa |
| `puedeAdministrarAreas` | igual con `/areas`: la pantalla existe, la entrada no |

Y el efecto que **comparten los nueve y no estaba escrito en ninguna parte**: cualquiera de ellos,
con una sucursal asignada, convierte a la persona en **supervisora de su sucursal**
(`esSupervisor`) — deja de ver solo sus tareas y pasa a ver las de toda la gente de ahí. Basta
**uno**. Es el hallazgo 3 visto de cerca: el permiso que se concede no es el que dice la etiqueta.

**Dos más, del lado del admin:** las nueve banderas **se guardan encendidas** al guardar con ese
rol (`personal.ts:657-667`), y **al bajarle el nivel a Colaborador el rol se va pero las nueve se
quedan** — hay que apagarlas a mano. Eso explica por qué el ajuste por puesto de esta misma noche
tuvo que tocar 41 fichas con un script y no bastaba con cambiarles el rol.

Y un administrador **NO gana** Espacio TEC, Promociones, Venta de Promos ni **esta misma pantalla
de Usuarios**, que desde el 13/sep es solo del dueño y de Dirección General.

**EL RÓTULO DEL ALCANCE MENTÍA.** Decía «Mismos privilegios pero solo dentro de las sucursales
asignadas». No son los mismos: hay **seis** cosas que un admin limitado no puede hacer **en
ninguna sucursal, ni en la suya** (Cierre Mensual, el nivel empresa del tablero, editar la
plantilla y generar credenciales de plaza, reabrir una tarea cerrada, archivar el mes, y ver a los
demás administradores). Ahora se listan al elegir esa opción.

#### CADA LÍNEA LLEVA DE DÓNDE SALE, Y ESO NO SE PINTA

`shared/permisos-catalogo.ts`: cada poder trae un campo `fuente` con el archivo y la condición
exacta de la que se dedujo. No se muestra — está para el día que alguien cambie una condición y no
cambie el texto. **Una descripción de permiso que miente es peor que ninguna: se decide un acceso
confiando en ella.**

#### LA PRUEBA, Y SU CONTROL NEGATIVO POR MECANISMO

`scripts/prueba-permisos-desglose.js`, 3 escenarios en el DOM más un teléfono:

    escenario                        9 permisos  desglose  grupos  poderes  «solo Global»  pierde
    nivel Colaborador                    9          0        0        0          0            0
    nivel Administrador (Global)         0          1        4       31          4            0
    nivel Administrador (Limitado)       0          1        4       31          4            6

    en 390px: 31 filas, 0 se salen (borde derecho 327 de 390), fuente mínima 12px

**El control negativo afirma el MECANISMO, no la aparición** (§8.11 c). Vaciado el catálogo en el
bundle servido: 3 aserciones rotas con código 2 — y **el `<div>` del desglose sigue pintándose**
con el contenido en 0. Una prueba que solo mirara `pm-desglose > 0` habría dado **verde con el
catálogo vacío**.

**El teléfono se mide en un IFRAME de 390px**, no con `--window-size`: Chrome topa la ventana en
504px, que está por encima del breakpoint de 480, así que la media query del móvil no se aplicaría
y la prueba mediría el escritorio dando verde sin tocar el caso. El testigo es `--tap-min` = 44px,
que vive en `styles.css`, **fuera de lo que este cambio toca**.

**Tres defectos míos que el arnés cazó, y los tres son de manual:**

1. **Busqué el radio de alcance en el mismo tick que el cambio de rol.** Ese bloque vive bajo
   `*ngIf="formRol === 'admin'"`, así que todavía no existía. **Abortó con código 3** — dijo «no
   pude medir» en vez de fingir un cero, que es exactamente para lo que está esa guardia.
2. **El ancla del control negativo llevaba la vocal acentuada de «menú»**, y el bundle la escapa:
   no pegaba. Habría sido un **no-op**, y un no-op da verde.
3. **Una aserción decía «y son 5» los poderes de solo-Global y son 4** — un número puesto a ojo,
   en el mensaje de un fallo, que es el peor sitio para equivocarse: el día que falle manda a
   buscar un quinto que no existe.

**Y el heredoc se rompió dos veces con las comillas anidadas del catálogo.** Cuarta y quinta vez
en este repo que la herramienta de edición corrompe o aborta en silencio (el `perl` con backticks
del 13/sep, el `\n` dentro de `\Q...\E` del 4/sep). Se reescribió con una herramienta que no
interpreta el contenido, y el reemplazo de bloque se hizo **por rango de líneas con los bordes
verificados**, comprobando después que el diff no tocara nada fuera de 573–640.

#### NO DESPLEGADO — y el motivo es de coordinación, no del cambio

**Commiteado y subido** (`a026495`, `HEAD == origin/main`), **sin `railway up`**. Hay **otras dos
sesiones en este mismo árbol**, y una respondió que `src/` **no compila ahora mismo**: está
moviendo la emisión del manual del navegador al servidor y tiene `robot-manual.service.ts` a
medias. `railway up` sube el **directorio de trabajo**, no lo commiteado — desplegar ahora
publicaría su trabajo roto a 186 personas. Es la regla del 4/sep cobrada por segunda vez, y esta
vez se resolvió igual: preguntando por `SendMessage` y esperando.

**Medido contra producción antes de subir**, recorriendo los 65 archivos del `ngsw.json`
(**4.40 MB, 0 fallos de lectura** — sin esa cifra el cero no vale):

    pm-desglose   0   <- el marcador de este paso
    cat-manual    0   <- el de OTRA sesion, commiteado en eca287d y NUNCA DESPLEGADO
    cl-bandeja    4   <- control: el recorrido si alcanza los chunks lazy

Ese `cat-manual = 0` es un hallazgo de paso que conviene no perder: **hay trabajo commiteado que
nadie desplegó y que se estaba dando por vivo.** El próximo `railway up` arrastra tres cosas de
tres sesiones, y las tres están declaradas como `nuevo` en `verificar-despliegue.js`: si alguna
sigue en 0 al salir, el despliegue no llevó lo que decimos que lleva.

**Lo que esto NO hace:** no arregla el hallazgo 3 — lo **documenta**. No mueve ninguna fase del
plan, no cambia una sola bandera ni un `[(ngModel)]`, y `prueba-menu-audiencias` confirma que
**los 15 perfiles ven exactamente las mismas rutas que antes**. Y **nadie ha entrado con una
cuenta real**: los tres escenarios son sesiones sintéticas en Chrome headless.

**Pendientes que este paso destapó y no tocó:** las tres banderas muertas siguen repartiendo
`esSupervisor` sin abrir nada — retirarlas cambia quién ve qué, así que es decisión de David, no
limpieza. Y `--text-secondary` **no existe** en el sistema de diseño (0 declaraciones) mientras
tres párrafos de esta pantalla lo invocan desde antes: se resuelven a nada, sin error. El CSS
nuevo no lo usa.

### 14/sep/2026 — LOS PRIVILEGIOS BAJAN AL PUESTO: de 6 administradores a 2

Instrucción de David: *«quiero que me des los nombres de los que son administradores, los vamos a
dejar como usuarios simples de acuerdo a su puesto»*. La lista **no estaba en el código** —el rol
y las banderas viven en `mdtask_usuarios`— así que el paso empezó por poder leer producción.

#### EL SCHEMA NO ES `public`, Y ESE CERO COSTÓ LA TARDE

`scripts/censo-administradores.js` abortó con **cero fichas** contra la base **correcta**. La
guardia hizo su trabajo —no concluyó «no hay administradores»— pero la causa tardó: las tablas de
MDTask viven en el schema **`eajd`** (159 fichas · 56 migraciones) y en **`public`** quedaron
**13 tablas vacías con 26 migraciones de mayo**. Un `select … from mdtask_usuarios` sin schema
resuelve por `search_path`, encuentra las vacías y devuelve **0 sin error**: es el §12 exacto —el
nombre equivocado no falla, miente— un nivel más arriba, sobre el **schema** en vez del campo.
Antes de dar con ello, `diagnostico-conexion.js` llegó a decir **«ESTA NO ES LA BASE DE
PRODUCCIÓN»** sobre la base que sí lo era. Los dos scripts nuevos **buscan** el schema (el de más
filas) e imprimen cuál eligieron y cuáles descartaron; `diagnostico-conexion.js` sigue mirando
solo `public` y hay que arreglarlo antes de volver a creerle.

**Lo que lo destapó fue una rareza, no una hipótesis:** `information_schema` devolvió
`_migraciones` con las columnas **duplicadas** (`id, aplicada_en, id, aplicada_en`). Una tabla no
puede tener dos veces la misma columna: eran dos tablas con el mismo nombre en schemas distintos.

#### EL CENSO: EL PROBLEMA NO ERAN 6 FICHAS, ERAN 66

    administradores (rol = 'admin')        6   →  4 de ellos de alcance GLOBAL, 3 sin entrar nunca
    con banderas de gestion y sin el rol  60
    con EL MISMO bloque de 9 banderas     40   ←  son admins de su sucursal sin llamarse asi

Entre esos 40: **dos anaquelistas, una promotora y una vendedora de piso** con
`puedeAdministrarPersonal`. Con **una sola** de las nueve, `esSupervisor()` da la vista de gestión
de **toda la sucursal**. Bajar el rol sin tocar las banderas no habría cambiado nada.

#### MI PRIMER PLAN ERA UNA ESCALADA, Y SOLO SE VIO CORRIÉNDOLO EN SECO

El mapa `privilegios-por-puesto.js` describe un **destino**, y el código lo aplicaba en las **dos
direcciones**: el primer plan **PONÍA** banderas a **17 personas que hoy no las tienen**. Un paso
que iba de *bajar* privilegios estaba repartiendo accesos nuevos a analistas y a servicios al
personal. Ahora **por omisión solo quita**; dar lo que falta exige `--completar` y lo que falta se
lista aparte, sin aplicarse. Es la regla del 11/sep —«ensanchar es la dirección peligrosa»— y esta
vez el que iba a ensanchar era yo.

**Y tocaba `alcance` en 70 trabajadores** para no cambiar un solo permiso: ese campo solo
significa algo en un admin (`permisos.util.ts` lo dice). Se acotó a las fichas con rol admin.

#### LO APLICADO, Y CÓMO SE VERIFICÓ

**41 fichas · 6 admins → 2** (el dueño por correo, y Guillermo Lopez, el único con
`direccion-general`). Verificado preguntándole a la **base**, no al script que escribió:

| puesto | banderas de gestión (mín/máx) |
|---|---|
| anaquelista (22) · cajero (13) · almacenista (6) | **0 / 0** |
| encargado-sucursal (7) · auxiliar-encargado (5) | 6 / 6 |
| gerencia-zona (3) | 7 / 7 |

Más: **41 fichas con su evento en `_historialPermisos`** (exactamente las tocadas), **112 sin
gestión contra 42 con gestión** —la muestra discrimina—, y las **18 fichas con banderas de
SERVICIO las conservan intactas**, que es el control de que no se barrió de más.

**Las de servicio no se tocan a propósito:** TEC, Tickets, Pagos, Flotilla y Promociones son
acceso a módulos para trabajar, no privilegios de mando. Quitarlas aquí dejaría gente sin poder
hacer su trabajo por un cambio que iba de otra cosa.

**Trece fichas sin `puestoId` quedaron pendientes y VISIBLES** (§8.5), no clasificadas por el
`cargo`, que es texto libre. Los **cuatro admins sin puesto sí se bajaron**, pero por orden
expresa de David y con interruptor propio (`--bajar-admins-sin-puesto`): pasan a trabajador **sin
ninguna bandera**, sin adivinarles el puesto.

**La reversa se escribió antes que la ida (§8.3):** `--aplicar` guarda primero un respaldo JSON
con rol, alcance y `datos` de cada ficha y no escribe nada si el respaldo no queda en disco;
`--revertir <archivo>` deja todo idéntico. El respaldo va al `.gitignore` porque `datos` incluye
el espejo de contraseña.

**Guardia nueva:** el script cuenta cuántos administradores quedarían **después** del plan y
**aborta si quedaría cero**. Quitar el rol a granel es exactamente como se deja a una empresa
fuera de su propia app.

#### 15/sep — LAS TRES ORDENES QUE SIGUIERON, Y EL CERO QUE CASI SE USA COMO DATO

**1 · Las 13 fichas sin `puestoId` quedan como trabajadores simples.** Misma dirección que todo
el paso —quitar, no dar— y **sin inventarles el puesto**: su `puestoId` sigue vacío, que es el
dato que de verdad falta. Medido después: **44 fichas activas sin puesto, todas en 0/0** banderas
de gestión.

**2 · Los 10 perfiles incompletos se completan**, por orden expresa (`--completar`). Sigue
exigiendo pedirlo: por omisión el script no da una sola bandera. Entre los dos, **23 fichas**.

**3 · «Los duplicados bórralos» → se CIERRAN.** El §5.5 prohíbe el borrado físico y aquí se ve por
qué no es formalismo: la ficha de *Maria Dolores* tiene **84 checklists** colgando y la de
*Yadira* **144**. Borrar la fila deja ese trabajo sin a quién atribuir y el pase de lista sin a
quién asignar. Desactivar hace lo que se pidió y se deshace en un comando. **5 fichas cerradas,
154 → 149 activas**, cada grupo con una sola viva.

**EL CERO QUE CASI SE USA COMO DATO.** Las 12 fichas duplicadas daban **`0 ENVIADOS`** — y un cero
idéntico en *todas* las filas se parece demasiado a una señal muerta. Medido antes de concluir:
**134 enviados de 4 148 checklists** en la tabla entera, así que el cero era real. El script lleva
esa comprobación dentro y **aborta** si algún día el total diera cero, porque entonces «0
enviados» en una ficha no probaría nada. Es §8.11(a) aplicado a una señal en vez de a una entrada.

**Y ese dato desbloqueó un empate de agosto.** La bitácora daba el caso Yadira/Yaadira por
irresoluble «porque las dos tienen tareas». Con la señal correcta se ve que **ninguna de las dos
ha enviado nunca nada**: *tener tareas asignadas* no es *haber trabajado* —el robot reparte, la
persona envía— así que el empate no existía. Gana la que tiene `puesto`, por **acceso y no por
historial** (el robot emite por `puestoId`: conservar la ficha sin puesto la dejaría sin tareas
nuevas). Las migraciones **053 y 054 de `pendientes/` quedan saldadas**, y llevan la nota escrita
en su cabecera para que nadie las aplique creyendo que faltan.

**Dos casos que el script se negó a resolver, y esa negativa es el diseño:**

- **Correo compartido** (`mataviejitas778@gmail.com`): dos nombres distintos con el mismo correo
  **no son un duplicado de una persona**. No hay ficha que conservar —quedarse con una sería
  elegir a cuál de las dos personas posibles se le atribuye lo que haga la otra— así que se
  cierran las dos.
- **Edgar Dayan Cortes Garcia**, dos fichas sin puesto, sin latido y sin trabajo: **ninguna señal
  las separa**, así que quedan intactas y visibles. Pendiente de decisión de David.

**Lo que sigue sin hacerse, dicho para que no se lea como resuelto:** **nada se fusionó**. Los 52
checklists de la ficha de Yaadira se quedan donde están, así que el historial de esa persona sigue
partido en dos. Y el modelo no cambió: estas banderas se vuelven a repartir desde la pantalla de
Usuarios, así que sin la plaza (Fase 3) el desorden se puede rehacer en una tarde.

#### LO QUE ESTE PASO NO HACE, dicho para que no se lea como resuelto

- **No despliega nada.** Cero archivos de `src/`, `api/` o `scripts/sql/`. El cambio ya está vivo
  porque es **dato**, y la gente lo nota sola: `app.ts:373` resincroniza el perfil **cada 60 s** y
  recarga al detectar un cambio de permisos.
- **No arregla el modelo**, solo el estado de hoy. Estas banderas se vuelven a repartir desde la
  pantalla de Usuarios, así que sin la plaza (Fase 3) el desorden se puede rehacer en una tarde.
- **Hallazgo de paso, sin resolver:** **«Luis David Navarro Alvarado» tiene dos fichas activas**
  con el mismo nombre. Es el hallazgo 1 otra vez, y suma al marcador de identidades por texto.
- **Una credencial quedó expuesta otra vez:** `railway variables -s MDTask` imprimió parte de la
  `DATABASE_URL` con su contraseña en pantalla (el enmascarado no aguantó el formato de tabla de
  Railway). **No se listan variables nunca más**: para comparar credenciales sin verlas, se usa
  `sha256` truncado, que es como se descubrió que MDTask y el proxy público comparten instancia.


### 14/sep/2026 (noche) — EL CATÁLOGO DEL MANUAL SE PUEDE DAR A MANO (paso B)

Instrucción de David: *«los catálogos que creaste de acuerdo a los puestos, los dejarás creados
como un catálogo para poder agregarlo a cualquier trabajador, quiero que le aparezca los usuarios
que tiene de acuerdo su sucursal»*. Y antes, enfrentado a las dos opciones: **entrega puntual**,
no aplicabilidad permanente.

**QUÉ ES.** Botón «Del manual» en la barra de Tareas → sucursal → **la gente de esa sucursal** →
la tarea, del catálogo agrupado por puesto y con buscador → fecha. Crea **un** checklist sellado
con su documento, su código y su **versión**, que no vuelve solo al día siguiente.

**LO QUE NO SE HIZO, Y ES LA DECISIÓN DE FONDO.** El payload **no se arma en la pantalla**: lo
arma `RobotManualService.entregarDelCatalogo`, que reusa `idemKey` y `armarChecklist` —las mismas
dos funciones de la entrega automática—. Dos versiones del sellado de una norma serían dos reglas
libres de discrepar, y la que discrepara lo haría en silencio: tareas que se ven iguales y se
juzgan distinto.

**LA LLAVE ES LA DEL ROBOT, y de ahí salen las dos propiedades que importan.** `idemKey` es
`tarea × periodo × sucursal × persona`, **sin el puesto dentro**. Así que asignar a mano algo que
el puesto de esa persona ya recibe produce **la misma llave**: no se duplica. Y volver a pulsar
no escribe nada. Un duplicado no se ve —solo sube el denominador de esa persona— que es
exactamente la clase de daño que nadie reporta.

#### TRES DEFECTOS ENCONTRADOS ANTES DE SUBIR, Y LOS TRES ERAN MÍOS

**1 · `guardarChecklist` SE TRAGA EL FALLO.** Reintenta tres veces y, si las tres fallan,
**registra en consola y devuelve** — no lanza. Envolverla en un `try/catch` daba un «creado»
aunque no se hubiera guardado nada: el peor resultado posible, porque quien asigna se va
convencido y la persona nunca ve la tarea. Se cambió por `post`, que sí lanza. Perder los
reintentos es aceptable: la llave es idempotente, así que volver a pulsar no puede duplicar.

**2 · `await setDoc` NO VUELVE SIN RED.** La promesa de Firestore se queda pendiente para
siempre, así que «Asignando…» habría sido el **«VERIFICANDO…» del 1/sep** otra vez. Ahora las dos
escrituras llevan tope con el nombre del paso, y **el orden se invirtió respecto al robot**: aquí
va primero la API. El motivo está escrito en el código — la app **lee de Postgres**, así que un
documento que solo esté en Firestore no lo ve nadie; de las dos escrituras, la que decide si esto
sirvió es la de la API. La copia a Firestore queda best-effort y su fallo se registra sin cambiar
el resultado.

**3 · `mostrandoPanelResponsables` ESCONDÍA TODOS LOS BOTONES DE CREAR.** Este getter decía «el
panel está en pantalla» sin mirar si lo que está es **el árbol**, que ocupa su sitio. Mientras
fueron dos pantallas no se notaba; con la lista unida, **una jefatura aterriza donde se pinta el
árbol**, así que «Tareas Únicas», «Bloque de Rutinas» y «Del manual» desaparecían — o sea,
**ninguna de las personas que crean tareas podía crear una**. Lo destapó la prueba nueva al no
encontrar su propio botón. Es el defecto más caro del día y llevaba horas desplegado.

#### LA PRUEBA CAPTURA EL DOCUMENTO QUE SALE POR EL CABLE

`scripts/prueba-catalogo-manual.js`. No mira la pantalla: el servidor de la prueba **intercepta el
POST** y lo compara campo por campo contra el catálogo **compilado con `tsc`**, no contra valores
tecleados en la prueba.

    id       man_encargado_sucursal_apertura_2026-9-14_canindo_ana_prueba_catalogo
    sello    _origenManual=true · _puestoId=encargado-sucursal
             _tareaManualId=encargado-sucursal.apertura
             _manualDocumento="… Encargada de Sucursal PH" · _manualVersion="1.0 · Agosto 2026"
    a mano   _asignadoAMano=true · _asignadoPor="Jefa Prueba Catalogo"
    8 puntos, los 8 pidiendo evidencia

**Y LA PRUEBA SE CORRIGIÓ A SÍ MISMA, que es lo que la vuelve fiable.** El primer intento
**reconstruía la llave a mano** y falló: mi periodo decía `2026-09-14` y el de la app `2026-9-14`,
porque `llavePeriodo` arma la fecha **sin rellenar** los ceros. Con esa llave falsa, el escenario
de idempotencia sembraba un checklist que la app no reconocía, así que creaba otro — y el reporte
habría dicho **«la idempotencia no aplica» sobre un mecanismo intacto**. Es §8.11(d) por tercera
vez. La solución es más fuerte que arreglar la réplica: **se quitó la réplica**. El segundo
escenario siembra **el id que la propia app acaba de producir**, así que no existe una tercera
versión de la regla que pueda discrepar, y lo que se prueba es justo lo que importa: que la app
**reconoce su propia llave**. De la forma se afirma lo que no depende del periodo (prefijo `man_`
y los tres slugs).

    escenario     POST /api/checklists   aviso en pantalla
    asignar              1               —
    ya existía           0               «Esa persona YA tiene esa tarea ese día…»

**Lo que este paso NO hace, dicho para que no se lea como resuelto:** no declara aplicabilidad
—mañana no vuelve sola—, **no cambia quién puede asignar** (sigue siendo el mismo permiso que
abre «Nueva Tarea», porque David dijo «eso lo veremos después»), y **nadie ha entrado con una
cuenta real**. La copia a Firestore es best-effort a propósito y su fallo no se le enseña a nadie
más que a la consola.


### 14/sep/2026 (tarde) — LA BARRA SE REHIZO EN CUATRO BOTONES, y dos defectos míos

David, sobre una captura de la barra que se había desplegado por la mañana
(`Pendientes | Enviadas` + `Todas 112 · Del manual 112 · Fuera del manual 0` +
`Mis tareas 9 | Toda la operación 112`): *«aquí lo vamos a cambiar, solo debe estar Pendientes
del equipo · Enviadas del equipo · Mis tareas pendientes · Mis tareas enviadas»*. Y dos
instrucciones más, cada una con su captura: *«quita este»* (el bloque «Avance del día») y *«este
bórralo»* (el botón «Limpiar bajas»).

**TRES EJES PASARON A UNO.** Había que cruzar mentalmente «pendientes/enviadas» × «origen» ×
«de quién». Ahora son las cuatro combinaciones que de verdad se usan, escritas con todas sus
letras. **El eje de origen se retiró entero**, y su propio número lo justificaba: los chips
decían `Del manual 112 · Fuera del manual 0`. Un eje cuyo segundo valor es cero en toda la
empresa no separa nada — y la pastilla 🔒 MANUAL de cada tarjeta sigue distinguiéndolas una por
una, que es donde la distinción importa.

**«DEL EQUIPO» ES ESTRICTO, Y LO DECIDIÓ DAVID ENFRENTADO AL NÚMERO.** Se le plantearon las dos
lecturas con su consecuencia: «todas, las mías incluidas» conservaba el 112, y «solo las de los
demás» lo bajaba a 103. Eligió lo segundo. **Los dos badges ahora suman el total sin repetir**,
que es justo lo que el eje anterior no podía dar: «Toda la operación» incluía las propias, así
que los dos números se solapaban y no se podían leer juntos.

#### LOS DOS DEFECTOS QUE EL ARNÉS CAZÓ, Y LOS DOS ERAN MÍOS

**1 · `verPorOrganigrama` QUEDÓ PERMANENTEMENTE TRUE.** Al quitarle `modoManual` y dejar solo
`puedeFiltrarVista && organigrama`, el getter pasó a valer siempre para cualquier supervisor. El
árbol seguía saliendo donde debía —la plantilla lo acotaba— pero **la rejilla de enviadas se
esconde con `!verPorOrganigrama`**, así que una Encargada abría «Enviadas del equipo» y veía la
**pantalla en blanco**. La prueba lo dio como `0 tarjetas` en los dos botones de historial y
abortó por falta de discriminación. El arreglo no fue parchear el `*ngIf`: la condición completa
vive ahora **en el getter**, para que los cuatro `*ngIf` que dependen de ella no puedan
desalinearse otra vez.

**2 · MI PROPIA MEDICIÓN CONTABA MAL, y esa es la más instructiva.** Para probar que «del
equipo» es estricto, contaba cuántas tarjetas llevaban mi nombre **en el `textContent` entero**.
Dio `2 de 2` en «Enviadas del equipo» — que se lee como **«el recorte no aplica»** — cuando el
recorte estaba perfecto: yo era la `createdBy` de las ocho filas del fixture, así que mi nombre
aparecía en tarjetas que no eran mías. **El defecto estaba en el instrumento, y me habría mandado
a depurar código que funcionaba.** Se corrigió mirando `.cl-meta-empleado`, que es el campo que
la regla usa de verdad (§8.11 b).

#### EL MÓVIL: 2×2, PORQUE LOS RÓTULOS SON LARGOS A PROPÓSITO

«Pendientes del equipo» dice lo que hace; «Todas» no decía nada. En 390px los cuatro en fila
quedarían a ~90px cada uno, con el texto partido en tres renglones — el «se descuadra» de la
captura del 13/sep por la otra puerta. En rejilla de dos columnas cada botón mide **169px y 51 de
alto**, y con DOS botones —el colaborador— la misma rejilla da una sola fila, sin regla aparte.

    la bandeja: 2 renglones, 109px de alto, 4 botones de 169/169/169/169px
    documento: scroll 390 de ventana 390 (no se desborda)
    testigo: el componente contó 286 de 286 entregas servidas

#### TRES CONTROLES CADUCARON A LA VEZ, Y SE SUSTITUYERON EN ESTE MISMO COMMIT

Es el corolario (e) cobrado tres veces seguidas en un día:

| control | qué le pasó |
|---|---|
| `prueba-eje-alcance-movil` | buscaba `.vista-tabs.eje-alcance`, clase que retiré. Abortaba. |
| `prueba-tarjeta-movil` | pulsaba la pestaña «Enviadas», que hoy se llama «Mis tareas enviadas» |
| `verificar-despliegue` | su marcador NUEVO era `cl-chip-origen`… y esa clase ya no existe |

El tercero es el que más enseña: de haberlo dejado como control, habría dado **0 en lo servido**
y el verificador habría abortado diciendo «el recorrido no alcanza el chunk» — una conclusión
**falsa**, porque el cero venía de haber borrado el código a propósito.

**Y una flakiness que salió de paso, dicha con sus dos corridas:** la prueba móvil dio una vez
`5 filas y badges en 0` y a la siguiente, **sin tocar nada**, `12 filas y 286`. Medía antes de
que respondiera el poll, y su guardia («¿hay filas?») no lo veía porque **el árbol pinta su
estructura aunque no haya llegado un solo checklist**. Se le puso el testigo que ya usa el otro
arnés: el subtítulo del componente, que dice cuántas entregas contó.

#### LO QUE SE QUITÓ, Y QUÉ SE CONSERVÓ DE CADA COSA

- **«Avance del día»** (la tira de `0% · 0 de 112 puntos cumplidos` con 62 en curso y 50
  vencidas). Se retiró del panel. **La medición NO se borró**: `resumen()` se sigue calculando
  —lo usan las tarjetas por persona— y con ella sus dos aciertos escritos, por si vuelve a
  pintarse: con total 0 sale «—» y no «0%», y la barra solo la llena lo CUMPLIDO.
- **«Limpiar bajas»**. Se fue el botón; `limpiarHuerfanas()` **sigue en el código sin nada que la
  llame**. Es una acción destructiva: quitarle la entrada y el código en el mismo paso dejaría
  sin nada que recuperar. Lo que desapareció es el camino para dispararla sin querer.

**Lo que esto NO prueba:** que se vea bien con un dedo real, y **nadie ha entrado con una cuenta
real**. Los seis escenarios son sesiones sintéticas. Y el `?ver=` que las rutas viejas llevaban
desde la mañana se fue con los chips: `/tareas-manual` y `/checklist` aterrizan ahora en la lista
completa, que es lo único que hay.


### 14/sep/2026 — LAS DOS LISTAS DE TAREAS SON UNA (paso A de 2)

Instrucción de David: *«quiero que estas dos queden unidas (Tareas fuera del manual y tareas
del manual) […] solo que esté todo ahí, ya te diré cómo le iremos haciendo»*.

Eran **dos entradas de menú y dos rutas con el MISMO componente**, separadas por
`data.modoManual` (el hallazgo 4, el componente dios sirviendo dos rutas). Ahora es **una
entrada `/tareas`** con una lista y tres chips —**Todas · Del manual · Fuera del manual**—, por
omisión «Todas». El menú baja de 12 a 11 entradas para un admin; el objetivo del documento 4
siguen siendo 7.

**LO QUE HABRÍA SIDO EL DESASTRE, y por qué no lo fue.** Mientras fueron dos pantallas, «el
manual no se edita» (§5.4) lo garantizaba **el modo**: en `/tareas-manual` no existían los
botones. Al juntarlas, ese interruptor deja de separar nada. Se midió **antes de tocar** y el
candado de verdad ya estaba **por tarjeta** —`esTareaDeManual` en la plantilla y, sobre todo,
dentro de `editarChecklist` y `eliminarChecklist`—, así que unir las listas no le quita el
candado a ninguna tarea. **Donde sí faltaba era en el panel de responsables**, que recibe un
`puedeEditar` único para todo el panel: ahora cada tarea lleva su `esManual` y la regla vive en
`shared/origen-manual.util.ts`, **una sola definición** para los dos componentes.

**LOS ENLACES VIEJOS ATERRIZAN EN SU MITAD, NO EN «TODAS».** `/tareas-manual` y `/checklist`
llevan meses en WhatsApp: siguen vivas y redirigen **con su `?ver=`**. El redirect es una
**función** y no una cadena porque un `redirectTo` de cadena **no puede llevar query params** —
se pierden en silencio, sin un solo error, y el enlace viejo abriría la lista entera.

#### TRES COSAS QUE SOLO SALIERON MIDIENDO

1. **La barra se partió en dos y le comió 48px al árbol.** El arnés del organigrama lo cazó con
   su aserción de diseño (al árbol le toca ≥55% de la pantalla): bajó de 58% a **50%**. Medido
   dentro de la barra —**ancho 1083px, izquierda 982 + derecha 368**— la derecha envolvía. Y la
   regla correcta no era «esconde las acciones en el chip manual» sino **«escóndelas con el
   ÁRBOL en pantalla»**: ahí no hay lista que agrupar y «Agrupar por persona» es un control que
   no hace nada. Quedó en **56%**. El arnés ahora imprime ese desglose: «la barra mide el doble»
   tiene dos causas —un grupo que envolvió o un grupo más alto— y desde fuera se ven igual.
2. **«Enviadas» nunca miró el apartado.** `cargarEnviadas()` empuja las filas crudas, así que el
   historial del Manual traía **también** las libres, y al revés. Con dos pantallas ya era
   incoherente; con el chip al lado sería mentira. Ahora se recorta con la misma función.
3. **Los badges de «Mis tareas / Toda la operación» contaban otro conjunto** (`checklists()`
   entero). Un badge que dice 12 al lado de una lista de 3 se lee como que la app perdió tareas.

#### LA PRUEBA NUEVA, Y SU CONTROL NEGATIVO POR MECANISMO

`scripts/prueba-tareas-unidas.js`, **6 escenarios en el DOM**:

    escenario                      aterriza en          chip activo        tarjetas  manual  editables
    entro a /tareas (por omision)  /tareas              Todas              5         3       2
    pulso «Del manual»             /tareas?ver=manual   Del manual         3         3       0
    pulso «Fuera del manual»       /tareas?ver=libres   Fuera del manual   2         0       2
    enlace viejo /tareas-manual    /tareas?ver=manual   Del manual         3         3       0
    enlace viejo /checklist        /tareas?ver=libres   Fuera del manual   2         0       2
    sin _origenManual (control)    /tareas              Todas              5         0       5

**Todas = 5 = 3 + 2**, y en «Del manual» **ninguna** de las tres ofrece editar ni borrar. El
control negativo **afirma el mecanismo, no la aparición** (§8.11 c): servido el mismo fixture
**sin `_origenManual`**, las cinco se vuelven editables y el chip «Del manual» cae a **0** — o
sea que el chip y el candado cuelgan de ese sello y no de otra cosa. La sesión es **una
trabajadora** a propósito: con un admin, el chip «Del manual» enseña el árbol y las tarjetas
darían cero, un cero que significaría «se pintó otra cosa» y no «no hay».

#### UN ARNÉS QUE LLEVABA UN DÍA SIN PODER CONCLUIR, Y NO SE VIO

`prueba-arbol-organigrama.js` exigía `arbol === 1` a **todas** las filas, y el 13/sep se le
añadió el escenario que mide **justo lo contrario** —que al pulsar «Mis tareas» el árbol
DESAPAREZCA—. Desde ese commit (`fbeeb3a`) **abortaba siempre en la última fila**: comprobado
con `git show fbeeb3a:…`, la guardia ya estaba escrita así. Un aborto con código 3 dice «no
medí» y es fácil leerlo como ruido.

Peor: el escenario **se imprimía y no se comprobaba**. No había una sola aserción sobre él, así
que el bug que David reportó podía volver y la tabla lo habría enseñado sin que nada fallara.
Ahora la guardia es «cada escenario monta **lo que vino a medir**», la ausencia esperada es una
aserción, y hay una tercera que exige que la muestra **discrimine** (árbol 1 en «toda la
operación» contra 0 en «Mis tareas»).

#### Y LA GUARDIA DEL DESPLIEGUE FALLÓ POR CUARTA VEZ — ahora en la EXTRACCIÓN

El 9/sep la guardia negaba solo `Building`; el 11 apareció `Deploying`; el 13 salió
`Initializing (4s)`. La lección quedó escrita: **afirmar el estado terminal, no enumerar los
transitorios**. Hoy escribí exactamente esa versión… y volvió a terminar en **0 esperas** con el
build corriendo.

**La condición estaba bien; lo que estaba mal era de dónde sacaba el valor.**

    # mal:  railway status | grep -oE '● [A-Za-z]+' | head -1
    #       «● Online · Building (53s)»  ->  «● Online»   (el -o corta el sufijo)
    # bien: railway status | grep -m1 'status:' | sed 's/.*status:[[:space:]]*//'
    #       y comparar la linea ENTERA contra «● Online»

Dos defectos en una línea, y el segundo es peor que el primero: el `-o` recorta el sufijo que
justamente dice que sigue trabajando, y el `head -1` podía tomar el `●` de **otro servicio**
—Redis y Postgres están siempre Online— en vez del de MDTask. La guardia no estaba mirando ni el
campo correcto ni el valor completo.

**La familia es la misma de siempre**, con una vuelta de tuerca que conviene nombrar: ya no
basta con que la CONDICIÓN afirme lo correcto — **la extracción también tiene que conservar lo
que la condición necesita**. Un `grep -o` que recorta convierte un estado transitorio en el
terminal, y el bucle concluye antes de tiempo con cara de haber esperado.

**Y EL NÚMERO QUE CIERRA CUÁL ES LA GUARDIA BUENA** —medido en las dos sesiones por separado,
sobre la misma salida de `railway status`:

    lineas de la salida ...........  40
    veces que aparece «status:» ...   1      <- rotulo UNICO
    lineas que llevan el circulo ●    16      <- de ellas, solo 2 nombran MDTask

Quince de esas dieciséis están **Online para siempre** —Redis, Postgres, conta-api,
hub-apps…—, así que **una guardia anclada al `●` tiene quince formas de equivocarse y una de
acertar**. La mía acertó de milagro: el bloque del servicio enlazado se imprime en la línea 10 y
la lista de todos los recursos en la 21, así que el `head -1` cayó en la 13, que es la de MDTask.
**Acerté por ocho líneas de orden de impresión.** Si Railway invirtiera esos dos bloques, el
bucle leería `conta-api` y volvería a concluir con el build corriendo.

Por eso la guardia se ancla al **rótulo `status:`, que aparece una sola vez**, y no al símbolo
que comparten dieciséis líneas. Es §8.11(b) otra vez —la guardia va sobre la entrada que de
verdad usas, no sobre un proxy de ella— y la cifra que lo demuestra es ese **1 contra 16**.

**Y la tercera ancla trampa, medida DURANTE el build para no dejarla como teoría.** De las 16
líneas con `●`, solo 2 nombran MDTask: la del bloque enlazado y la de «All resources». La
sospecha razonable era que dijeran cosas distintas —una el estado del DESPLIEGUE y otra el del
SERVICIO, que sigue sirviendo con la instancia vieja—. **No es así:** en la misma llamada, con el
build corriendo, las dos decían exactamente `● Online · Building (53s)`.

    status:        ● Online · Building (53s)
      - MDTask:    ● Online · Building (53s) · https://mdtask-production-ed88.up.railway.app

O sea que el peligro de `grep MDTask | grep -q Online` **no es que las líneas difieran**: es que
`grep -q` casa una SUBCADENA y se come el sufijo, igual que el `grep -o`. Tercera forma del mismo
defecto en el mismo día. (Y `grep MDTask | head -1` toma la línea 12, que es el rótulo del bloque
y **no trae estado ninguno**: esa falla hacia el lado seguro, colgándose hasta el timeout.)

**La regla, ya sin rodeos:** anclar al campo único (`status:`) y comparar la **línea completa**
con igualdad, nunca con `grep`. Cualquier coincidencia parcial sobre esta salida encuentra
«Online» aunque diga lo contrario tres palabras después.



Y la comprobación que lo salvó fue no creerle al estado: `0 esperas` se verificó contra el
**marcador servido**, que seguía en 0. El estado dice «probablemente»; la cifra dice «sí».

**DESPLEGADO:** `cl-chip-origen` **0 → 1**, **22 controles en pie**, 65 archivos · 4.43 MB
recorridos · 0 fallos, y arranca (Chrome headless con perfil limpio: **69 700 bytes** de DOM,
`app-root` y `md_rescate_arranque` presentes; sin sesión `/tareas` cae al login, que es su
guard). El marcador se validó en las dos direcciones **antes** de subir —0 ocurrencias en
`412547c`, 1 en `dist/`— y el que traía el despliegue anterior (`46px 56px 38px`) **bajó a
control**: ya valía 1 en producción, así que dejarlo arriba habría dado verde sin comprobar nada
de hoy. Lo avisó la otra sesión antes de que se cobrara.

**Un número del verificador que se iba a malinterpretar:** decía `dist/ local: 69 archivos`
contra `servido: 65`. No falta nada — son los 65 del `ngsw` más el `index.html` y los **tres
service workers**, que el `hashTable` no declara. Comprobado archivo por archivo (0 sobrantes de
builds viejos) y el verificador ahora imprime el desglose en vez del total pelado.

**Lo que esto NO hace, dicho para que no se lea como resuelto:** no toca ningún número de
tablero, no mueve ninguna fase del plan, y **nadie ha entrado con una cuenta real** — las seis
combinaciones son sesiones sintéticas en Chrome headless. El **paso B** (el catálogo del manual
asignable a cualquier trabajador, como entrega puntual sellada con su documento y versión)
queda acordado y sin empezar; el permiso para asignar lo decide David después («eso lo veremos
después»), así que hoy sigue siendo el mismo que abre «Nueva Tarea».


### 14/sep/2026 — TAREAS DEL MANUAL EN UN CELULAR: no era el riel, era el árbol

Instrucción de David sobre una captura de las dos pastillas «Mis tareas / Toda la operación»:
*«cuando están en un dispositivo móvil, ya sea iPhone o Android, se descuadra; hazla
responsiva»*.

**LO PRIMERO QUE MEDÍ ESTABA BIEN, Y ESA ES LA MITAD ÚTIL DEL DÍA.** La hipótesis obvia era que
el riel segmentado se partía en dos renglones. Se midió a 390, 375 y 360px con el contador real
de la captura (286, tres dígitos): **cae en un renglón en los tres anchos**. La hipótesis era
falsa y la prueba lo dijo antes de que tocara una línea.

Lo que destapó el defecto fue **mirar la captura**, no medirla — la lección del 7/sep otra vez.
Debajo del riel, el árbol del organigrama:

| a 390px | antes | después |
|---|---|---|
| filas que se salen de la pantalla | **5 de 5** | **0 de 12** |
| borde derecho más lejano | **x = 698** | x = 347 |
| eje derecho cabecera / filas | 333 / 688 | **337 / 337** |
| «Solo con manual» | cortado (x=397 con la barra en 359) | dentro |
| riel «Mis / Toda» | 295px, segmentos 114 y 169 | 345px, **170 y 170** |

**Y EL DIAGNÓSTICO RESPONSIVO DEL 13/SEP DECÍA «ninguna pantalla se desborda» CON RAZÓN.**
El documento medía 390 de 390. El desbordamiento vive **dentro de `.org-card`**, que lleva
`overflow: hidden`: el exceso no se desplaza, **DESAPARECE**. Medir el scroll del documento no
contesta esta pregunta. La métrica correcta es el borde derecho de las filas contra el ancho de
la pantalla — y mi primer intento tampoco la tenía: usé `scrollWidth > clientWidth` de la fila,
que da **0 filas cortadas** con el eje en x=698, porque la fila mide 100% de un padre que ya se
desbordó. Un proxy del arreglo, §8.11(b), a la primera.

#### LAS DOS CAUSAS, Y LA PRIMERA NO SE VE LEYENDO LA CLASE

1. **`.org-menu` es un ITEM DE REJILLA**, y un item de rejilla trae `min-width: auto`: no puede
   encogerse por debajo del ancho **mínimo** de su contenido. Con una fila que pedía 698px, el
   contenedor se estiraba a 698 en una pantalla de 390. El arreglo es `min-width: 0`, y va **sin
   media query** porque es correcto a cualquier ancho.
2. **`.org-puesto-datos` era `flex: 0 0 auto` con cinco columnas fijas (262px).** Es
   **exactamente el defecto del 7/sep con otra ropa**: allá tres pastillas en `nowrap`
   estrangulando el título de la tarjeta, aquí cinco cifras empujando la fila fuera del teléfono.
   En móvil se reduce a las tres que se leen —MANUAL · AVANCE · VENC.— escondiendo las ranuras
   **por posición sobre la misma clase que usa el encabezado**, así que la cabecera pierde las
   mismas dos columnas y los ejes **no pueden** desalinearse. Una sola definición, como ya estaba
   escrito en ese archivo.

Lo mismo en `.org-fila` (sucursal · persona · tarea · entrega), que tenía `.org-fila-datos {
flex: 0 0 auto }`: en la captura se veía como «📕 …», el nombre de la tarea reducido a tres
puntos mientras «Semanal 19:00 6 pts» se quedaba con todo el ancho.

#### UN DESFASE DE 4px QUE YA LLEVABA MESES EN TABLET

Al bajar el padding de la fila de 14 a 10 reabrí el desfase del 4/sep… y al medirlo apareció que
**ya estaba roto desde antes**: `@media (max-width: 860px) { .org-puesto { padding-right: 10px } }`
(de un cambio anterior) movía la fila y **dejaba la cabecera en 14**. Medido a 768px: cabecera
711 contra fila 715. A ojo es «casi alineado»; en la pantalla son los rótulos fuera de su
columna. Las dos mitades de un mismo eje se mueven juntas o no se mueven.

**Y una asercion que culpaba sin datos:** decía «no llevan el mismo padding horizontal» sin
haberlo comprobado. Ahora imprime los cuatro paddings medidos — y gracias a eso se vio que el
culpable era la regla de 860, no la mía.

#### EL RIEL SEGMENTADO: UN EMPATE DE ESPECIFICIDAD QUE NO SE LEE

`.cl-toolbar .vista-tabs { gap: 6px; flex-wrap: wrap }` y `.vista-tabs.eje-alcance { gap: 0 }`
tienen **la misma especificidad (0,2,0)**, así que gana la que va después en el archivo — la
primera. Resultado: 6px de separación **dentro** del riel y `wrap` encendido, o sea dos pastillas
sueltas metidas en una caja y un interruptor que se parte en cuanto el contador crece. Eso no se
ve leyendo ninguna de las dos reglas: hay que pintarlo. En teléfono los dos rieles van ahora de
borde a borde con los segmentos al 50%.

#### LO QUE MIRAR AÑADIÓ Y MEDIR NO

Con las cuatro aserciones en verde, la captura seguía mostrando **`AVANCEVENC.`** pegados —los
rótulos van pegados al borde derecho de su columna, y con 4px de separación se leen como una
palabra— y el botón «rama» convertido en un **círculo**, porque hereda el mínimo táctil de 44px
(`--tap-min`, 13/sep) con un texto de cuatro letras. No se le bajó la altura: ese mínimo existe
para el dedo. Se le dio ancho.

#### LA PRUEBA, Y SU CONTROL DE ESCRITORIO

`scripts/prueba-eje-alcance-movil.js` (nueva). El ancho y el contador son parámetros —la primera
corrida midió 390px con 6 tareas y **pasó en verde**; el caso de la captura son 286—. Aborta si
`--tap-min` no vale 44px, que es el testigo de «es móvil» y **vive en `styles.css`, fuera de lo
que este arreglo toca** (§8.11 b). Y lleva `ESCRITORIO=1`, que invierte la pregunta: a 1024px la
rejilla tiene que seguir teniendo **5 columnas y 262px**. Sin eso, un arreglo que arrasara con la
pantalla grande habría pasado las cuatro corridas de móvil en verde. **201 pruebas** unitarias en
verde, sin tocar ningún `.ts`.

**DESPLEGADO:** `46px 56px 38px` **0 → 1** (marcador validado en las dos direcciones antes de
subir: 1 en `dist/`, 0 en producción), **20 controles en pie**.

**Lo que esto NO hace:** el **rediseño visual** de Tareas del Manual que David pidió aparte sigue
pendiente. Esto la hace caber, no la hace bonita. Y nadie la ha abierto todavía desde un iPhone
real — Chrome no es Safari, y esa lección ya está escrita arriba.


### 13/sep/2026 (tarde) — LO QUE DAVID VIO EN PANTALLA, y lo que ninguna medición había visto

Ocho cambios salidos de que **David abrió la app y miró**. Ninguno se habría encontrado con las
herramientas de la mañana, y esa es la lección que los une: *medir en un motor y desplegar en
otro deja huecos que no son visibles desde aquí*.

**1 · iPHONE: EL QUE MOVÍA LAS TABLAS ERA EL ZOOM DE SAFARI, NO EL DISEÑO.**
*«Mis celulares son iPhone, se mueven todas las tablas y los botones.»* Safari hace **zoom al
enfocar un campo cuya fuente mide menos de 16px**, y al ampliar descoloca la pantalla entera. En
`/tareas-manual` había **tres campos a 14px**. El diseño responsivo estaba bien; el navegador lo
estaba ampliando. **No se había visto porque todo el diagnóstico se corrió en Chrome, que no hace
esto.** Y ojo con el atajo que parece la solución: `user-scalable=no` **no lo evita** —Safari lo
ignora desde iOS 10—; lo único que funciona es llegar a 16px, que es el umbral exacto. Resultado:
**3 → 0**, y cero en las 16 pantallas. El diagnóstico ahora lo cuenta como métrica propia.

Y la otra mitad: **faltaban las metas `apple-mobile-web-app`**. iOS no lee `display: standalone`
del manifest antes de 16.4, así que el acceso directo abría la app **dentro de Safari** — con su
barra apareciendo y desapareciendo al hacer scroll, moviendo el contenido.

**2 · «MIS TAREAS» MOSTRABA EL ORGANIGRAMA Y NADA MÁS.**
El `*ngIf` del árbol **no miraba `vistaTareas`**, y la lista exigía `!verPorOrganigrama`: con el
árbol encendido esa pestaña **no podía pintar otra cosa**. El filtro funcionaba —busca por
nombre—; su resultado no se pintaba en ningún sitio. **La misma condición estaba en tres sitios**
y el tercero era el peor: el estado vacío también, así que sin tareas propias quedaba **pantalla
en blanco**. Verificado en el DOM y discrimina: árbol 1 / lista 0 en «toda la operación»; árbol 0
/ lista 2 al pulsar «Mis tareas».

**3 · PLANTILLA Y PASE DE LISTA SALEN DE CONTROL.** David no las encontró, y **estaban mal
colocadas**: `/control` agrupa análisis; la plantilla es una *definición* (como Manual por Puesto)
y el pase de lista es *operación diaria*. Ahora `DEFINICIONES → Plantilla de sucursal` y
`CONTROL → Pase de lista`. **Quién las ve no cambió** (sigue `esJefatura`, ahora desde
`estructuraGuard`): mezclar una reorganización de menú con un cambio de permisos hace imposible
saber cuál rompió algo.

**4 · TRES BUGS DE PANTALLA QUE ERAN MÍOS.** El selector de sucursal salía **vacío** en Pase de
lista —la lista salía solo de `mdtask_plazas`, así que sin plazas no había nada que elegir, y la
pantalla **se bloqueaba a sí misma en el único estado en que todos la iban a abrir por primera
vez**—. El aviso *«no tienes esta sucursal en tu alcance»* **se le mostraba a un administrador**,
porque opinaba sobre permisos durante la carga. Y **«Cargando…» eterno**: cuatro peticiones sin
tope. Eso último es **el «VERIFICANDO…» del 1/sep en otra pantalla**, y el arreglo de entonces se
había quedado dentro de `login.ts`; ahora vive en `shared/con-tope.util.ts` para que la próxima
no tenga que aprenderlo.

**5 · EL DUEÑO DE LA APP.** `davidcisneros2209@outlook.es` reconocido **por correo**, no por una
bandera de su ficha — porque las banderas se pierden, y tras la parte C será la **única cuenta
nominal**. Tres capas: `esDueno` en los predicados, `conPermisosDeDueno` al entrar, y el JWT
firmado con rol admin (los endpoints deciden con el token, no con la ficha). 11 pruebas, las dos
direcciones: no reconoce un typo del dominio, y un perfil **sin correo** no es el dueño —si la
cadena vacía contara, las decenas de fichas sin correo tendrían acceso total.

**6 · USUARIOS: SOLO EL DUEÑO Y DIRECCIÓN GENERAL.** Antes bastaba ser admin o traer
`puedeAdministrarPersonal` — **una bandera que se otorga desde esa misma pantalla**, así que el
acceso se propagaba solo. Y se cerró un hueco que ya existía: `/personal` **solo pedía
`authGuard`**, o sea que se entraba escribiendo la URL. *El menú no es un permiso.*

**7 · LA ACTUALIZACIÓN LA DECIDE EL USUARIO.** `app.ts` decía literalmente «aplicarla SOLA, sin
avisar» y recargaba en el acto. Es verdad que no se pierde lo guardado, pero sí lo que está a
medias. Ahora avisa con una barra — **salvo en el login, donde se aplica sola**, y esa excepción
es la mitad del diseño: sin ella, un «actualizar más tarde» deja gente en versiones viejas para
siempre.

**8 · EL NÚMERO DEL MANUAL SE DESGLOSA.** La pastilla decía «3 tareas» y al abrir el puesto no
aparecía ninguna: solo las *entregas* de hoy, que es otra cosa. Una **tarea** es lo que el manual
manda, exista o no quien la reciba.

#### LO QUE ESTE BLOQUE DEJA COMO REGLA

- **Chrome no es Safari.** Un diagnóstico headless en un solo motor da verde sobre bugs que el
  100% de la operación sufre. Si el arnés no puede ver una clase de fallo, hay que **decirlo** —y
  añadirle la métrica— en vez de leer su verde como ausencia de problemas.
- **Yo rompí tres pruebas y no me enteré hasta correrlas.** `prueba-arbol-organigrama`,
  `prueba-dom-evidencia` y `prueba-tarjeta-movil` parcheaban el bundle buscando una cadena del
  código **minificado** de `ApiService.token()`; al cambiar ese método para el acceso por plaza,
  el ancla desapareció y **las tres abortaron a la vez**. Ya no parchean: siembran `md_token`, que
  es el camino legítimo del producto.
- **El verificador de despliegue aprendió a contar** (`minimo: N`). Hizo falta porque el correo
  del dueño **ya valía 1** en producción —está en la lista de exentos del modo mantenimiento— y
  preguntarle «¿aparece?» habría dado verde **antes** de desplegar.
- **Declarar una audiencia no basta: hay que poder ejercerla.** Al estrechar `/personal`, *ninguno*
  de los quince perfiles sintéticos la conservaba, así que la regla no se probaba en ningún caso.
  Y meter dos perfiles nuevos al set histórico salió peor: comparan contra el menú de `78b89a3`,
  así que «ganan» todo y producen once diferencias que tapan las de verdad. La comprobación vive
  **aparte** y pregunta lo suyo.
- **Dos veces me comió texto una herramienta.** Un `perl` entre comillas dobles dejó que bash
  evaluara los backticks de mis comentarios y borró dos palabras; y un comentario HTML **dentro**
  de una etiqueta de apertura rompió la compilación (NG5002). El código quedó bien las dos veces
  y el comentario mutilado — que es peor que no tenerlo.

**Lo que NO se tocó, y sigue esperando decisión:** el **eje transversal**. Medido: el filtro de
visibilidad tiene **un solo eje** (`permitidas.includes(c.store)`) y el campo `store` hace **dos
trabajos** —dónde ocurre y de qué departamento es—. Por eso una tarea que la Encargada levanta
para Mantenimiento la ve uno **o** el otro, nunca los dos. Es exactamente la «unidad responsable
contra unidad servida» del §5. Ampliar visibilidad es la dirección peligrosa, así que no se toca
sin una prueba de audiencias propia.

### 13/sep/2026 — SE ACABAN LOS USUARIOS POR PERSONA (parte A de 3)

Instrucción de David, literal: *«no quiero que quede ningún usuario más que el que tiene el correo
de davidcisneros2209@outlook.es […] dame la forma de cómo vamos a manejar el login […] cómo vamos
a darle su usuario a anaquelista uno, dos y tres»*. El correo lo confirmó por escrito antes de
escribir una línea: va a ser **el único acceso administrador de la app**, y equivocarlo deja a
todo el mundo fuera, él incluido.

**LA DISTINCIÓN QUE HACE QUE ESTO NO SEA UN CORREO COMPARTIDO:**

    CUENTA   por PLAZA      «PH-ANA-1» + un PIN de 6 dígitos
    PERSONA  por COBERTURA  quién la ocupa hoy lo dice el pase de lista

Sin la segunda mitad esto sería exactamente `mataviejitas778@gmail.com`: una cuenta que varias
personas usan y cuya evidencia no se puede atribuir a nadie (migraciones 051-053). Con ella, cada
foto sigue teniendo nombre — que es el invariante §4, «identidad (cobertura, no nombre escrito)».

**Las tres decisiones que David tomó**, y quedan anotadas para no rediscutirlas: las fichas de
persona **se apagan como cuenta y se conservan como nombres** (borrarlas dejaría al pase de lista
sin a quién asignar y a los checklists de agosto sin a quién atribuir); la credencial es
**código + PIN**, no QR; y si nadie pasó lista, la persona **entra igual**, elige quién es y queda
marcada como «identidad sin confirmar» — porque bloquear la sucursal entera porque la Encargada
llegó tarde es peor que el problema que resuelve.

#### EL CÓDIGO NO ES UNA CONCATENACIÓN DE TRES LETRAS

Es lo que más trabajo llevó, y sale del catálogo real: **`surtidor-ventas` y `surtidor-sucursal`
abrevian los dos a SUR**. Si dos plazas comparten código, **dos personas entran a la misma
cuenta** y toda la trazabilidad construida hoy se cae en el último metro.

`generarCodigos()` genera contra el conjunto de los ya usados y alarga hasta ser único, tomando
la inicial del **siguiente token** — no más letras de la primera palabra, que en esos dos son
ocho iguales. Y es **determinista**: el mismo conjunto en otro orden da los mismos códigos,
porque regenerar no puede cambiarle el código a quien ya lo tiene apuntado en una libreta.

**Nunca reutiliza un código**, ni el de una plaza retirada: si se reciclara, la hoja impresa de
alguien empezaría a abrir la plaza de otra persona y **ninguna de las dos se enteraría**.

#### EL PIN SE GENERA EN EL SERVIDOR, Y SE VE UNA VEZ

`crypto.randomInt`, no `Math.random` del navegador: con la hora de creación, los PINs de una
sucursal entera se volverían adivinables. Se guarda como **hash bcrypt** —el mismo esquema de
`api/_password.js`— y se devuelve **una sola vez**. No hay forma de consultarlo después, y la
pantalla lo dice **antes** de generar, no después: si alguien cierra sin anotar, hay que
regenerar.

Los dos índices de la 058 son la mitad de la seguridad: `codigo` único en **toda** la tabla
(incluidas las inactivas) y **una** credencial activa por plaza.

**173 pruebas**, 17 nuevas. La guardia que importa: en una sucursal con 13 puestos × 4 plazas,
**ningún código se repite**.

**Y un detalle cazado al elegir el marcador de despliegue:** `pl-hoja` **ya existía** en
`agenda.css` con otro significado. Angular encapsula, así que no chocan en runtime, pero dos
clases con el mismo nombre y distinto sentido son una trampa para el siguiente que lea.
Renombrada a `pl-acc-hoja`. Es la tercera vez hoy que elegir un marcador destapa algo: la
mecánica de validarlo en las dos direcciones encuentra cosas que no venía a buscar.

**DESPLEGADO:** `pl-accesos` 0 → 5, migración 058 aplicada con `0 filas (0 activas)` —el
resultado declarado de antemano— y `/api/credenciales-plaza` en 401.

**LO QUE FALTA, y el orden es obligatorio:**

| | qué | riesgo si se adelanta |
|---|---|---|
| **B** | el login acepta código+PIN, y la pantalla «¿quién eres hoy?» | ninguno: los dos logins conviven |
| **C** | apagar las cuentas de persona | **si A y B no están probadas con gente real, la operación se para** |

**C no se toca hasta que una sucursal real haya entrado por plaza y funcione.** Es el único paso
de todo el día que puede dejar a 186 personas fuera de la app.

#### PARTE B — DESPLEGADA. Y dos cosas que habrían roto en producción

El flujo completo: código + PIN autentica la **plaza**; después la app pregunta **«hoy esta plaza
la cubre María, ¿eres tú?»**. Si no, la persona se elige de la lista y **se registra una suplencia
sola**, para que la Encargada lo vea corregido en vez de adivinarlo.

**Y la plantilla se abrió a cada sucursal**, por instrucción de David: *«necesito pedirle a RH
cómo van a acomodar las plantillas; mientras, déjalo libre — como crea tu plantilla de tu
sucursal»*. Lo que **no** se abrió es repartir accesos: proponer cuánta gente debe haber y crear
las llaves de entrada son cosas distintas, y `esAdmin` sigue gobernando lo segundo.

**Los dos defectos encontrados antes de subir, y los dos eran fatales:**

1. **`ApiService.token()` va SIEMPRE a Firebase Auth.** Quien entrara por plaza no tiene usuario
   de Firebase, así que el método habría lanzado «Sin sesión activa» y la persona habría entrado
   a una app **completamente vacía**, sin un solo error visible que explicara por qué. Ahora el
   JWT propio manda si existe — y **se borra** al entrar por el login normal y al cerrar sesión,
   porque un token de plaza olvidado haría que la siguiente persona en ese navegador trabajara
   con la sesión de la anterior, y su evidencia quedaría a nombre de otra.
2. **`pareceCodigoDePlaza` mira la FORMA**, y un usuario llamado `ana-maria-2` casa con el patrón.
   Sin caída al login de siempre, esa persona habría quedado desviada a un login que no es el
   suyo y **no podría entrar nunca**. Ahora, si el código no existe, el servidor responde
   `campo: "codigo"` y el cliente sigue por el camino normal, en silencio. Un fallo de **red** no
   cae —no prueba que el código no exista— y se dice lo que pasó.

Verificado en producción: `plz-codigo` 0 → 2, `/api/login` y `/api/login-plaza` los dos vivos, y
un código inexistente devuelve exactamente `{"error":"Ese código no existe…","campo":"codigo"}`.

#### PARTE C — ESCRITA Y NO APLICADA, y el motivo no es prudencia

`scripts/sql/pendientes/059_apagar_cuentas_de_persona.sql`. **Hoy es imposible aplicarla, como
hecho:** no existe **una sola credencial de plaza**. Nadie ha capturado una plantilla → no hay
plazas → no hay códigos ni PINs. Apagar las cuentas ahora cerraría **los dos caminos a la vez**.

Vive en `pendientes/` porque `db-migrate.js` hace `readdirSync` **sin recursión**. Verificado: el
runner lista **56 archivos y la 059 no está entre ellos**. Sus tres candados abortan en vez de
dejar a nadie fuera: que exista al menos una credencial activa; que **alguien haya entrado** con
ella —que exista no prueba que funcione, y no se apaga el acceso de 186 personas sobre una
teoría—; y que la ficha de `davidcisneros2209@outlook.es` exista y esté activa, o la migración
dejaría la app **sin administrador**.

**No borra ninguna ficha:** marca `datos.accesoPorCuenta = false`. Nombre, puesto y sucursal
intactos, y la persona sigue apareciendo en el pase de lista, el historial y el bot.

### 13/sep/2026 — RESPONSIVO: la regla estaba escrita y no regía

Instrucción de David: la app no es responsiva —empezando por el sidebar— y hay que revisar
**todos** los módulos, para celular y tablet.

**«No es responsiva» no es accionable, así que primero se midió.**
`scripts/diagnostico-responsivo.js` (nuevo) carga cada pantalla en un **iframe** de 390, 768 y
1024 —Chrome topa las ventanas en 504px, así que `--window-size` no sirve: lección del 7/sep— y
cuenta tres cosas distintas: desbordamiento del documento, texto por debajo de 12px y controles
por debajo de 40px.

**EL RESULTADO NO FUE EL ESPERADO, y por eso valía medir:** *ninguna* pantalla se desborda
horizontalmente. Lo que está mal es lo **táctil y lo tipográfico**, que no se ve en una captura
y se sufre con el dedo.

| en celular (390px) | antes | después |
|---|---|---|
| controles < 40px | **14 a 34 por pantalla** | **0 en 9 de 16**, resto entre 1 y 11 |
| textos < 12px | **552 casos** | **152** |
| desbordamiento horizontal | ninguno | ninguno |

**LA CAUSA RAÍZ.** El sistema Mercado **ya declaraba** `--tap-min: 44px` para punteros gruesos, y
tenía **cero usos**. `--row-h-sm` (44px en táctil): cero usos. La regla existía desde el design
system y **nunca se aplicó a un solo elemento** — es el mismo patrón que la Fase 2.1, una norma
escrita que no rige.

El arreglo es **una regla global, no 370 parches**: `min-height: var(--tap-min)` sobre
`:where(button, select, .nav-item, input…)`. Con `:where()` la especificidad queda en **cero** —es
un piso, no una imposición— y en escritorio `--tap-min` vale `0px`, así que **no cambia un píxel**
ahí. Lo nuevo que alguien escriba nace bien sin tener que acordarse.

**Y la media query lleva también el ancho, no solo `pointer: coarse`.** Dos motivos, y el segundo
casi me hace dar por bueno un arreglo sin verificar: **Chrome headless reporta `pointer: fine`**,
así que la primera medición del «después» salió **idéntica** al «antes» —34 controles chicos,
igual que sin tocar nada—. El arreglo estaba bien; **lo que no podía verlo era el instrumento**.

**Piso tipográfico en 6 archivos, solo en táctil/móvil** (en escritorio se conserva la densidad de
Operations). Los peores: `td-chip` a **nueve píxeles** en el Tablero de Dirección —la pantalla que
se enseña en una junta— y `nav-seccion` a 10px en el sidebar, que aparece en las 16 pantallas.

#### EL DIAGNÓSTICO SE CORRIGIÓ A SÍ MISMO DOS VECES, y por eso sus cifras valen

1. **Servía `/api` vacío** y declaró sana `/tareas-manual` — con la pantalla sin una sola tarjeta
   que desbordar. Es el cero falso del 4/sep. Ahora siembra checklists con textos largos reales y
   **reporta cuántos nodos midió**; una pantalla con menos de 40 nodos sale marcada porque su
   «cabe» no vale.
2. **Decía «21 pantallas» y eran 16.** `/areas`, `/calendario`, `/bloques`, `/turnos` y
   `/flotilla` son `redirectTo: 'home'` desde que se retiraron, así que medía **/home seis veces**
   y lo contaba como seis pantallas. Se vio porque las cinco daban cifras **idénticas hasta el
   último dígito**. Lleva guardia para que no vuelva a pasar.

**Y mordió otra vez el bug de Git Bash:** `/tareas-manual` llegó como
`C:/Program Files/Git/tareas-manual`, Angular cayó al wildcard y se midió el **login**. Tercera
vez en el proyecto (31/ago, 3/sep, hoy); ahora la ruta se normaliza por código.

**Lo que queda, dicho con su cifra:** **152 textos** siguen por debajo de 12px, sobre todo en
`/home` (88). Ya no salen de clases con nombre propio sino de reglas de componente con más
especificidad que el piso global. Y **falta el rediseño visual de Tareas del Manual**, que David
pidió aparte: esto la hace usable, no la hace bonita.

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
números de Padre Hidalgo. **Nadie ha entrado con una cuenta real** a verla.

#### Y EL PASO SIGUIENTE, EL MISMO DÍA: LA PLANTILLA SE VUELVE PLAZAS NUMERADAS

`cobertura.util.ts` + `api/plazas.js` + `api/coberturas.js`, y un botón en la pantalla de
plantilla que crea las plazas que faltan. Las tablas existían desde la 056 y **hasta hoy no las
leía nadie**.

**EL NÚMERO DEJÓ DE SER UN PROBLEMA, y eso merece quedar escrito porque contradice —con razón—
lo que decidimos el 9/sep.** El paso 3.1a dejó las plazas naciendo con `numero` en NULL, y el
motivo era bueno: se sembraban desde el **censo**, y ordenar personas por nombre o por uid para
repartir los números habría sido inventar la cuadrilla (§8.5). Generándolas desde la
**plantilla**, ese problema desaparece: la plantilla dice «cuatro anaquelistas», así que las
plazas son 1, 2, 3 y 4 **antes de que exista una sola persona**. El número sale de la
autorización, no de la gente, y quién es el Anaquelista 1 lo decide la Encargada al asignar —que
es exactamente donde esa decisión pertenece.

**LA SUPLENCIA GANA AL TITULAR**, y es el caso que más importa de `coberturaDelDia`. Si mandara
el titular, la evidencia de un día de suplencia quedaría **firmada por quien no estuvo**: eso es
`verificado_falso` (§4) fabricado por el propio software. Control negativo: invertir el peso
rompe la aserción con `Expected 'ana' to be 'supl'` y tumba además la guardia de discriminación.

**`hueco` ≠ `sin_asignar`**, que es la tercera vez hoy que aparece la misma familia. «Alguien
miró y declaró que no hay nadie» contra «nadie ha pasado lista». Si se pintaran igual, **la
sucursal que hace el trabajo bien saldría peor que la que no hace nada**.

**Dos decisiones de `planDePlazas` que no son obvias:**

- **Rellena el hueco en vez de continuar la serie.** Con 1, 2 y 4 existentes y plantilla de
  cuatro, falta **la 3**. Continuar dejaría una cuadrilla 1, 2, 4, 5 tras una sola baja, y a los
  dos meses los números no significarían nada.
- **Cuando sobran plazas, las reporta y no las toca.** Retirar una plaza ocupada dejaría a una
  persona sin sitio sin que nadie lo decidiera. §8.5 aplicado a una acción destructiva.

**Y `resumenDelDia` detecta a una persona puesta en DOS plazas el mismo día:** su evidencia
contaría dos veces y una de las dos plazas está sola en realidad. Es el defecto que la plaza vino
a romper —«los tres anaquelistas reciben la MISMA tarea»— reapareciendo por la puerta de la
cobertura.

**142 pruebas.** Una falló al escribirla y **era mi fixture**: creaba dos coberturas con el mismo
`id`, algo imposible en la base donde `id` es *primary key*, así que el desempate se quedaba sin
nada por lo que desempatar. Se corrigió el fixture, no la función — que es la dirección correcta,
y la contraria a la del `sinManual: 3`.

**Desplegado:** `pl-plazas` **0 → 7**, 6 controles en pie, 59 archivos · 4.37 MB, y
`/api/plazas` y `/api/coberturas` en **401** (montados, pidiendo token).

#### Y EL PASE DE LISTA, también el mismo día

`Control → Pase de lista`. La Encargada elige sucursal y día, y para cada plaza dice quién la
ocupa: **titular**, **suplencia de hoy** o **hueco con motivo**.

**Quién edita aquí NO es quien edita la plantilla, y es la decisión de diseño del paso.** La
plantilla la captura **Dirección** —cuántas plazas se autorizan es una decisión de la empresa— y
el pase de lista lo hace la **Encargada** —quién cubre hoy es una decisión de su turno—.
Pedirle a Dirección que capture el pase de lista haría que **no lo capturara nadie**. El `ve` de
la pestaña decide quién ABRE; `puedeAsignar` decide quién TOCA, y se comprueba antes de cada
escritura: que una sucursal no salga en un `<select>` no es un permiso.

**El manual ya autoriza este trabajo**, así que no hace falta norma nueva: punto 8 del Checklist
de apertura del Encargado («Tareas del día asignadas en Mega Dulces Task») y punto 7 de su
operación («Ausencias cubiertas»).

**Tres reglas nuevas, todas probadas:**

- **El titular nuevo cierra al anterior EL DÍA ANTES**, no el mismo: si los dos cubrieran la
  misma fecha, ese día tendría **dos responsables** (§5.2). Y la prueba no se conforma con mirar
  el plan —lo **aplica** y vuelve a preguntar quién cubre el 12 y quién el 13.
- **La suplencia no cierra al titular.** Es un día; al siguiente vuelve solo, sin que nadie
  reabra nada.
- **CORREGIR ES UN EVENTO NUEVO (§5.5):** entre dos coberturas del mismo día gana la **capturada
  después** (`creadaEn`). Antes ganaba la primera, y con eso una corrección no habría servido de
  nada: para arreglar un error habría que **borrar** la fila mala, que es justo lo prohibido. Fue
  un cambio de regla sobre `coberturaDelDia`, con su caso.

**E idempotente a propósito:** asignar a quien ya está no escribe nada. Sin eso, un doble clic
cerraría la cobertura de alguien y le abriría otra idéntica, **partiendo su historia en dos**.

**156 pruebas.** La pantalla nombra lo que falta —«sin asignar» con borde punteado, distinto del
hueco, que sí es un dato capturado— y **avisa cuando una persona quedó en dos plazas el mismo
día**: su evidencia contaría dos veces y una de esas plazas está sola.

**Desplegado:** `pa-sin_asignar` 0 → 2, **7 controles en pie**, 63 archivos · 4.39 MB, y arranca
(67 802 bytes).

**Anécdota de herramienta que vale anotar:** el `perl` que insertó la pestaña iba entre comillas
dobles, así que **bash evaluó los backticks de mis comentarios** y se comió dos palabras —«dentro
de la pantalla (), no aqui: este decide»—. El código quedó bien y el comentario **mutilado**, que
es peor que no tenerlo. Misma familia que el `\n` dentro de `\Q...\E` del 4/sep: la herramienta
de edición corrompe en silencio y solo se ve releyendo lo que escribió.

**LO QUE FALTA AHORA:** el **acceso por plaza** —entrar como «Anaquelista 1» en vez de con el
correo de una persona—. La cadena ya está completa hasta aquí: plantilla → plazas numeradas →
cobertura del día. Lo que falta es el login, y **no se debe tocar hasta que haya sucursales
pasando lista de verdad**: una cuenta de plaza sin cobertura registrada pierde el nombre de quien
firmó, que es el problema del correo compartido de las migraciones 051–053.

Y sigue siendo cierto que **nadie ha capturado una sola plantilla**, así que las dos pantallas
abren vacías: la de plantilla con la lista de puestos, y la de pase de lista diciendo «esta
sucursal todavía no tiene plazas» y dónde se crean.

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
