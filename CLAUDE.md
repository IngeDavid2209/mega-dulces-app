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
   > Hoy `shared/item-completado.util.ts` hace exactamente eso: si el colaborador escribe
   > cualquier nota o entrega con retraso, TODOS los items cuentan como hechos. Medido hoy, el
   > efecto real es de 1 punto (migración 045): el riesgo es futuro, no presente — y por eso
   > mismo es el momento más barato para corregirlo. `productividad.util.ts` hereda el defecto
   > porque llama a `esItemHecho`.
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
| 2 | Que los números digan la verdad (hecho ≠ justificado + primeras pruebas) | 1 | 0 | ⬜ **adelantada: va antes de la 1** |
| 1 | Cerrar el ferrocarril: una sola base | 3 | 0 | ⬜ |
| 3 | La estructura como dato (unidad, sucursal, ámbito, puesto, plaza, cobertura) | 4 | 1 | ⬜ |
| 4 | Navegación (4.1 se puede hacer YA, sin dependencias) | 1.5 | — / 3 | 🔄 **4.1 ✅ · 4.1b: 2a–2d ✅ (15→12 entradas) · falta el Paso 3 para llegar a 7 · 4.3 espera Fase 3 · el Dashboard ya se gatea por jefatura (3/sep)** |
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
| `productividad.util.ts` hereda el defecto de `esItemHecho` | Invariante §5.3 | 2.1 |
| `productividad.util.ts` sin pruebas (calcula cumplimiento, puntualidad, turno, ritmo) | §8.8 | 2.2 — **primera prueba a escribir** |
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
