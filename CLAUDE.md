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
- **Commit selectivo, nunca `git commit -a`.** El repo no tiene `.gitattributes` ni
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
| 0 | Medir antes de tocar (divergencia, KPIs congelados, detener `corte.js`) | 0.5 | — | 🔄 **0.1 ✅ · 0.3 ✅ (migración 045) · falta 0.2** |
| 2 | Que los números digan la verdad (hecho ≠ justificado + primeras pruebas) | 1 | 0 | ⬜ **adelantada: va antes de la 1** |
| 1 | Cerrar el ferrocarril: una sola base | 3 | 0 | ⬜ |
| 3 | La estructura como dato (unidad, sucursal, ámbito, puesto, plaza, cobertura) | 4 | 1 | ⬜ |
| 4 | Navegación (4.1 se puede hacer YA, sin dependencias) | 1.5 | — / 3 | ⬜ |
| 5 | Verificación con muestra + hallazgos + causas | 2 | 3 | ⬜ |
| 6 | Tablero por nivel + cierre diario + roll-up | 2 | 5 | ⬜ |
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
| Entrada de menú 20: "Productividad y turno" | Congelamiento §7 | 4.1 (se funde en Control) |
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
11. **Un cero no es un resultado hasta que sepas de cuántas líneas salió.** El 31/ago/2026, tres
    veces en un día, un `0` o un `OK` vino de un comando que no midió nada (una ruta que Git Bash
    convirtió mal, un `grep -c` sobre entrada vacía). Todo script de diagnóstico **imprime el
    tamaño de sus entradas antes de concluir** y **aborta** si alguna viene vacía: "no pude leer"
    y "no hay nada" son cosas distintas y se ven idénticas. Aplica igual a las verificaciones que
    hagas tú: cita la cifra de la que sale el cero.
12. **Cuidado con los nombres heredados de Firestore.** Los campos del documento y las columnas
    de Postgres NO coinciden: en Firestore la fecha es `date`, en Postgres es `fecha` (el mapeo
    completo está en `scripts/migrar-checklists.js`). Consultar Firestore con el nombre de la
    columna devuelve cero documentos, sin error.

## 9. Bitácora del plan

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
