/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUÉ LE ESTÁS DANDO A ALGUIEN — EL DESGLOSE DEL ROL «ADMINISTRADOR»
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. En la pantalla de Usuarios, el selector de
 * Nivel de Acceso ofrece dos opciones y una se llama «Administrador (Panel
 * Total)». Esas dos palabras eran, hasta hoy, TODA la explicación: al elegirla
 * el bloque de los nueve permisos de colaborador desaparecía y no quedaba una
 * sola línea diciendo qué se acababa de conceder.
 *
 * Y no es poco: medido el 14/sep/2026, `rol === 'admin'` aparece 135 veces en
 * 44 archivos. Nadie —ni quien escribió la app— puede contestar «¿qué puede
 * hacer un admin?» sin recorrerlos. Por eso el desglose se escribe UNA vez,
 * aquí, y la pantalla solo lo pinta.
 *
 * ─── LA REGLA DE ESTE ARCHIVO: NADA SE ESCRIBE DE MEMORIA ─────────────────
 * Cada línea de abajo lleva, en su `fuente`, el archivo y la condición exacta
 * de la que sale. Una descripción de permiso que MIENTE es peor que no tener
 * descripción: se toma una decisión de acceso confiando en ella. Si alguien
 * cambia una condición y no cambia el texto, la `fuente` es lo que permite
 * cazarlo — y por eso no se borra aunque no se pinte.
 *
 * ─── LO QUE ESTE ARCHIVO NO HACE ──────────────────────────────────────────
 * No concede ni quita nada. Es texto. El acceso lo siguen decidiendo
 * `permisos.util.ts`, `alcance.util.ts`, `nav.config.ts` y los guards. Poner
 * aquí una línea de más no le abre una pantalla a nadie; lo único que produce
 * es una pantalla que miente, que es exactamente lo que vino a evitar.
 */

/** Un poder concreto que el rol concede. */
export interface PoderAdmin {
  /** Qué gana, dicho como lo diría alguien que no programa. */
  texto: string;
  /**
   * De dónde sale. NO se pinta: es la prueba de que el texto no se inventó, y
   * lo que se revisa el día que alguien dude de una línea.
   */
  fuente: string;
  /**
   * `true` cuando el poder solo lo tiene el Administrador con acceso GLOBAL.
   * La pantalla lo marca, porque es la diferencia que de verdad se decide al
   * capturar la ficha.
   */
  soloGlobal?: boolean;
}

export interface GrupoPoderes {
  titulo: string;
  /** Una frase que dice de qué va el grupo. */
  entrada: string;
  poderes: PoderAdmin[];
  /** Tono del bloque: informa, advierte o niega. */
  tono: 'da' | 'quita' | 'ojo';
}

/**
 * ─── GRUPO 1 ──────────────────────────────────────────────────────────────
 * Los apartados que aparecen en su menú SOLO por ser administrador. Todos
 * verificados contra `shared/sidebar/nav.config.ts`, que es la única
 * definición del menú desde el paso 4.1.
 */
const MENU_QUE_GANA: GrupoPoderes = {
  titulo: 'Apartados que se le abren en el menú',
  entrada:
    'Estos aparecen solos, sin que le prendas ningún permiso de abajo. Son ' +
    'los que gana por el puro hecho de ser administrador.',
  tono: 'da',
  poderes: [
    {
      texto: 'Tickets — levanta vales de servicio, los atiende y los cierra con firma. Entra aunque no le prendas el permiso de Tickets.',
      fuente: 'nav.config.ts · ve: grupoTickets === true || esAdmin(u)',
    },
    {
      texto: 'Pagos — luz, agua, internet y sus comprobantes. Entra aunque no le prendas el permiso de Pagos.',
      fuente: 'nav.config.ts · ve: grupoPagos === true || esAdmin(u)',
    },
    {
      texto: 'Auditoría — busca cualquier tarea pasada de cualquier persona y abre sus fotos.',
      fuente: 'nav.config.ts · ve: esAdmin(u) || puedeVerHistorial',
    },
    {
      texto: 'Control operativo, con sus CUATRO pestañas: Estadísticas, Ranking, Productividad y Sucursales. Un colaborador con permisos nunca alcanza las cuatro.',
      fuente: 'control.tabs.ts · las cuatro pestañas empiezan con esAdmin(u) ||',
    },
    {
      texto: 'Manual por Puesto — consulta qué tareas del Manual le tocan a cada puesto del organigrama.',
      fuente: 'nav.config.ts · ve: esAdmin(u) || puedeCrearRutinas',
    },
    {
      texto: 'Días de Descanso — programa los descansos de la gente.',
      fuente: 'nav.config.ts · ve: esAdmin(u) || puedeAdministrarPersonal',
    },
    {
      texto: 'Pase de lista — dice quién cubre cada plaza hoy: titular, suplencia o hueco.',
      fuente: 'nav.config.ts · ve: esJefatura, y esJefatura deja pasar a todo admin',
    },
    {
      texto: 'Plantilla de sucursal — ve cuántas plazas de cada puesto están autorizadas. Para CAMBIARLAS hace falta acceso Global.',
      fuente: 'nav.config.ts · ve: esJefatura · plantilla.ts:252 editar = esAdminGlobal',
    },
    {
      texto: 'Dashboard — el tablero. Las cifras de la empresa entera (las diez unidades, el silencio, el reparto de causas) solo con acceso Global.',
      fuente: 'nav.config.ts · ve: hayTableroPara = esJefatura · verNivelEmpresa = esAdminGlobal',
    },
    {
      texto: 'Cierre Mensual — cierra el mes y baja el PDF. Este NO lo ve un administrador limitado a sucursales.',
      fuente: 'nav.config.ts · ve: esAdmin(u) && alcance global',
      soloGlobal: true,
    },
    {
      texto: 'Seis pantallas más por enlace directo (Calendario, Áreas, Turnos, Bloques, Flotilla y Tareas asignadas): no salen en el menú de nadie, pero si alguien le pasa la liga por WhatsApp, él entra y nadie más.',
      fuente: 'nav.config.ts · las seis huérfanas · ve: esAdmin, oculta: true',
    },
  ],
};

/**
 * ─── GRUPO 2 ──────────────────────────────────────────────────────────────
 * Lo que puede hacer DENTRO de las pantallas. Es la mitad que no se ve en el
 * menú y la que de verdad pesa: aquí están los poderes sobre el trabajo y la
 * evidencia de otras personas.
 */
const PODER_EN_PANTALLA: GrupoPoderes = {
  titulo: 'Lo que puede hacer dentro de las pantallas',
  entrada:
    'Esto no se ve en el menú y es lo que más pesa: son poderes sobre el ' +
    'trabajo, la evidencia y las cuentas de otras personas.',
  tono: 'da',
  poderes: [
    {
      texto: 'Edita y borra CUALQUIER tarea, no solo las que él creó. Un colaborador con Gestión de Checklists solo toca las suyas.',
      fuente: 'checklist.html:539,547 · rol admin || checklist.createdBy === currentUser.nombre',
    },
    {
      texto: 'Crea tareas y se las asigna a cualquier persona de su alcance.',
      fuente: 'checklist.html:55,70,80 · rol admin || puedeCrearChecklists',
    },
    {
      texto: 'Manda el recordatorio por WhatsApp (el botón de la campanita).',
      fuente: 'checklist.html:487,750 · rol admin || puedeCrearChecklists',
    },
    {
      texto: 'En el panel de responsables es el único que puede editar; los demás solo crean y notifican.',
      fuente: 'checklist.html:638 · [puedeEditar] = rol admin, a secas',
    },
    {
      texto: 'Vuelve a abrir una tarea que ya estaba cerrada. Requiere acceso Global.',
      fuente: 'checklist.ts:1803 · tarea.cerrado === true && esAdminGlobal(sesion) === false',
      soloGlobal: true,
    },
    {
      texto: 'Abre la agenda personal de cualquier persona desde el selector de auditoría.',
      fuente: 'agenda.html:75 · ngIf currentUser.rol === admin',
    },
    {
      texto: 'Ve el calendario de cualquier empleado, no solo el suyo.',
      fuente: 'calendario.ts:255,324 · rol admin && empleadoSeleccionado distinto de Todos',
    },
    {
      texto: 'Borra publicaciones de otras personas en el Espacio TEC (si además le prendes ese permiso).',
      fuente: 'espacio-tec.ts:412 · autorUid === miUid() || rol admin',
    },
    {
      texto: 'En Flotilla, da de alta vehículos y resuelve las solicitudes de los demás.',
      fuente: 'flotilla.ts:71 · get esAdmin() devuelve rol === admin',
    },
    {
      texto: 'Archiva el mes y borra las fotos del cierre. Requiere acceso Global, y no tiene vuelta atrás.',
      fuente: 'cierre-mensual.ts:1100,1277 · if (!this.esAdminGlobal()) return',
      soloGlobal: true,
    },
    {
      texto: 'Genera las credenciales de acceso por plaza (el código y el PIN de «Anaquelista 1»). Requiere acceso Global.',
      fuente: 'plantilla.ts:341,376 · if (!this.esAdmin) return, con esAdmin = esAdminGlobal',
      soloGlobal: true,
    },
    {
      texto: 'Le aparece el asistente de voz y chat, que no ve ningún colaborador.',
      fuente: 'app.ts:55 · get mostrarAsistente() devuelve MOSTRAR_ASISTENTE && esAdmin',
    },
    {
      texto: 'Recibe el trabajo dirigido a «ADMINISTRADORES DEL SISTEMA», que es una sucursal que solo existe para ellos.',
      fuente: 'checklist.ts:895 · store ADMINISTRADORES DEL SISTEMA devuelve emp.rol === admin',
    },
    {
      texto: 'El menú lo rotula como «Gerente» debajo de su nombre.',
      fuente: 'sidebar.html:164 · rol admin pinta Gerente, si no Colaborador',
    },
  ],
};

/**
 * ─── GRUPO 3 ──────────────────────────────────────────────────────────────
 * La trampa que nadie ve al capturar: los nueve interruptores de abajo se
 * guardan ENCENDIDOS. No es que «no apliquen»: se escriben en `true` en la
 * ficha, y si mañana le bajas el rol a Colaborador, se queda con los nueve.
 */
const LAS_NUEVE_SE_PRENDEN: GrupoPoderes = {
  titulo: 'OJO — los nueve permisos de Colaborador se guardan encendidos',
  entrada:
    'Al guardar con este nivel, los nueve interruptores de Colaborador se ' +
    'escriben como SÍ en su ficha, los hayas visto o no.',
  tono: 'ojo',
  poderes: [
    {
      texto: 'Gestión de Checklists, Ver Manual por Puesto, Tareas Únicas, Checkstore, Estadísticas, Calendario, Auditoría, Áreas y Administración de Personal: los nueve quedan en SÍ.',
      fuente: 'personal.ts:657-667 · puedeXxx: formRol admin ? true : formPuedeXxx',
    },
    {
      texto: 'Y esto es lo que hay que cuidar: el día que le bajes el nivel a Colaborador, el rol se va pero LAS NUEVE BANDERAS SE QUEDAN. Hay que apagarlas a mano, una por una, o sigue viendo casi todo.',
      fuente: 'personal.ts · al cambiar el rol no se limpia ninguna bandera',
    },
  ],
};

/**
 * ─── GRUPO 4 ──────────────────────────────────────────────────────────────
 * Lo que NO gana. Es la mitad que más sorprende: hay cuatro apartados que un
 * administrador no ve aunque sea el nivel más alto del selector.
 */
const LO_QUE_NO_GANA: GrupoPoderes = {
  titulo: 'Lo que NO gana por ser administrador',
  entrada:
    'Estos cuatro no se le abren solos. Si los necesita, hay que prenderle su ' +
    'permiso arriba, uno por uno.',
  tono: 'quita',
  poderes: [
    {
      texto: 'Espacio TEC — sigue pidiendo su propio permiso.',
      fuente: 'nav.config.ts · ve: grupoTec === true, sin esAdmin',
    },
    {
      texto: 'Promociones — pide Formato o Expediente. Ni los administradores lo ven sin uno de los dos.',
      fuente: 'nav.config.ts · ve: promocionesFormato || promocionesExpediente || grupoPromociones',
    },
    {
      texto: 'Venta de Promos — pide Cajera, Vendedor o Monitor.',
      fuente: 'nav.config.ts · ve: ventaPromosCaja || ventaPromosVendedor || ventaPromosMonitor',
    },
    {
      texto: 'ESTA MISMA PANTALLA, la de Usuarios. Desde el 13/sep solo entran el dueño de la app y quien tenga el puesto de Dirección General en el organigrama. Un administrador normal no puede dar de alta a nadie.',
      fuente: 'alcance.util.ts · veUsuarios = esDueno(u) || puestoId === direccion-general',
    },
  ],
};

/** El desglose completo, en el orden en que se pinta. */
export const PODERES_ADMIN: GrupoPoderes[] = [
  MENU_QUE_GANA,
  PODER_EN_PANTALLA,
  LAS_NUEVE_SE_PRENDEN,
  LO_QUE_NO_GANA,
];

/**
 * Lo que un Administrador LIMITADO A SUCURSALES pierde frente a uno Global.
 *
 * Se separa del desglose de arriba a propósito: el alcance es la única
 * decisión del formulario que reparte poder sin cambiar el rol, y hasta hoy se
 * explicaba con una línea —«Mismos privilegios pero solo dentro de las
 * sucursales asignadas abajo»— que es incompleta. No son los mismos
 * privilegios: hay seis cosas que un limitado NO puede hacer en ninguna
 * sucursal, ni siquiera en la suya.
 */
export const LO_QUE_PIERDE_EL_LIMITADO: string[] = [
  'El Cierre Mensual: no le aparece en el menú.',
  'Las cifras de la empresa entera en el Dashboard. Sus propios números sí los ve.',
  'Cambiar la Plantilla de sucursal y generar las credenciales de plaza (código y PIN).',
  'Volver a abrir una tarea que ya se cerró.',
  'Archivar el mes y borrar las fotos del cierre.',
  'Ver a los demás administradores en la lista de Usuarios: solo ve colaboradores.',
];
