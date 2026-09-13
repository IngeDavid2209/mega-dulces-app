/**
 * 👑 EL DUEÑO DE LA APLICACIÓN — las pruebas
 *
 * §8.8, y aquí lo que se produce no es un número: es ACCESO TOTAL. Un fallo en
 * una dirección deja al administrador fuera de su propia app; en la otra, se lo
 * regala a quien no debe. Las dos se prueban.
 *
 * El contexto: tras la parte C, `davidcisneros2209@outlook.es` va a ser la ÚNICA
 * cuenta nominal que quede. Por eso su acceso no puede depender de un campo
 * editable de su ficha —el mismo `rol` que se cambia desde la pantalla de
 * Usuarios— sino del correo.
 */
import {
  esDueno, esAdmin, esAdminGlobal, sucursalesPermitidas, conPermisosDeDueno, CORREO_DUENO,
} from './permisos.util';

describe('el dueño de la aplicación', () => {

  it('se reconoce por su correo, tal cual', () => {
    expect(esDueno({ correo: CORREO_DUENO })).toBe(true);
  });

  it('tolera mayúsculas y espacios, porque así se teclea de verdad', () => {
    expect(esDueno({ correo: '  DavidCisneros2209@Outlook.ES ' })).toBe(true);
  });

  it('también lo reconoce por `email`, que es como viaja en algunos perfiles', () => {
    expect(esDueno({ email: CORREO_DUENO })).toBe(true);
  });

  it('NO reconoce correos parecidos', () => {
    // El caso que importa de este lado: un typo NO puede dar acceso total, y
    // tampoco otro dominio. En este proyecto ya hubo dos fichas creadas por un
    // apellido invertido y una doble «a» (marcador de identidad, §9).
    expect(esDueno({ correo: 'davidcisneros2209@outlook.com' })).toBe(false);
    expect(esDueno({ correo: 'davidcisneros2209@outlook.es.mx' })).toBe(false);
    expect(esDueno({ correo: 'davidcisneros220@outlook.es' })).toBe(false);
    expect(esDueno({ correo: 'davidcisneros2209@gmail.com' })).toBe(false);
  });

  it('un perfil sin correo NO es el dueño (y no revienta)', () => {
    // Si una cadena vacía contara, cualquier ficha sin correo —y hay decenas—
    // tendría acceso total.
    expect(esDueno({})).toBe(false);
    expect(esDueno({ correo: '' })).toBe(false);
    expect(esDueno({ correo: '   ' })).toBe(false);
    expect(esDueno(null)).toBe(false);
    expect(esDueno(undefined)).toBe(false);
  });

  it('ES ADMIN GLOBAL aunque su ficha diga que es trabajador sin alcance', () => {
    // El caso que esto existe para cubrir: el día que su ficha quede con un
    // campo mal, tiene que poder entrar igual — es la única cuenta que va a
    // quedar y no habría forma de arreglarlo desde dentro.
    const fichaRota = { correo: CORREO_DUENO, rol: 'trabajador', alcance: 'sucursales', sucursales: ['Canindo'] };
    expect(esAdmin(fichaRota)).toBe(true);
    expect(esAdminGlobal(fichaRota)).toBe(true);
    // Y «todas las sucursales», que es lo que significa el alcance global.
    expect(sucursalesPermitidas(fichaRota)).toBeNull();
  });

  it('y eso NO se le regala a otro trabajador con la ficha igual de rota', () => {
    // La guardia que hace que la prueba de arriba signifique algo: si esto
    // también diera true, el caso anterior pasaría por el camino equivocado.
    const otro = { correo: 'otra.persona@megadulces.com.mx', rol: 'trabajador', alcance: 'sucursales', sucursales: ['Canindo'] };
    expect(esAdmin(otro)).toBe(false);
    expect(esAdminGlobal(otro)).toBe(false);
    expect(sucursalesPermitidas(otro)).toEqual(['Canindo']);
  });
});

describe('el perfil del dueño se normaliza al entrar', () => {

  it('le enciende rol, alcance y TODAS las banderas', () => {
    const p: any = conPermisosDeDueno({ correo: CORREO_DUENO, nombre: 'David', rol: 'trabajador' });
    expect(p.rol).toBe('admin');
    expect(p.alcance).toBe('global');
    for (const bandera of [
      'puedeAdministrarPersonal', 'puedeAdministrarAreas', 'puedeCrearChecklists',
      'puedeCrearRutinas', 'puedeCrearTareasUnicas', 'puedeVerCalendario',
      'puedeVerCheckstore', 'puedeVerEstadisticas', 'puedeVerHistorial',
      'grupoTec', 'grupoTickets', 'grupoPagos', 'grupoFlotilla', 'grupoPromociones',
      'promocionesFormato', 'promocionesExpediente',
      'ventaPromosCaja', 'ventaPromosVendedor', 'ventaPromosMonitor',
    ]) {
      expect(p[bandera]).withContext('falta la bandera ' + bandera).toBe(true);
    }
  });

  it('conserva lo demás de su perfil: no lo reemplaza, lo completa', () => {
    const p: any = conPermisosDeDueno({ correo: CORREO_DUENO, nombre: 'David Cisneros', uid: 'abc' });
    expect(p.nombre).toBe('David Cisneros');
    expect(p.uid).toBe('abc');
  });

  it('A NADIE MÁS LE CAMBIA NADA', () => {
    // La mitad peligrosa. Si esto tocara a otros perfiles, cada persona que
    // entrara se llevaría permisos que nunca tuvo.
    const otro = { correo: 'ana@megadulces.com.mx', rol: 'trabajador', puedeVerEstadisticas: false };
    const salida: any = conPermisosDeDueno(otro);
    expect(salida).toBe(otro as any);           // el MISMO objeto, sin copiar
    expect(salida.rol).toBe('trabajador');
    expect(salida.puedeVerEstadisticas).toBe(false);
  });

  it('GUARDIA: el normalizador DISCRIMINA', () => {
    // Sin esto, un `conPermisosDeDueno` que encendiera todo para todos pasaría
    // la primera prueba de este bloque sin que nadie lo note.
    const dueno: any = conPermisosDeDueno({ correo: CORREO_DUENO });
    const otro: any = conPermisosDeDueno({ correo: 'ana@megadulces.com.mx' });
    expect(dueno.puedeVerEstadisticas).toBe(true);
    expect(otro.puedeVerEstadisticas).toBeUndefined();
  });
});
