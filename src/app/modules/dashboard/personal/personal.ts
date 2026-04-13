import { Component, signal, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router'; 
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth'; 
import { Firestore, collection, doc, setDoc, deleteDoc, onSnapshot } from '@angular/fire/firestore';
import * as ExcelJS from 'exceljs';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-personal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './personal.html',
  styleUrls: ['./personal.css']
})
export class PersonalComponent implements OnInit, OnDestroy {
  isMenuOpen = false;
  toggleMenu() { this.isMenuOpen = !this.isMenuOpen; }

  currentUser: any = null; 
  usuarios = signal<any[]>([]);
  usuarioEnEdicion: any = null;
  terminoBusqueda = '';
  isModalOpen = false;
  mostrarPassword = false;


  // Formulario
  formNombre = ''; formUsuario = ''; formCorreo = ''; formPassword = '';
  formRol = 'trabajador'; formCargo = 'Trabajador General'; 
  
  // 🔥 PERMISOS
  formPuedeCrearChecklists = false; 
  formPuedeCrearRutinas = false;       
  formPuedeCrearTareasUnicas = false;  
  formPuedeVerCheckstore = false;
  formPuedeVerEstadisticas = false; 
  formPuedeVerHistorial = false; 
  formPuedeAdministrarPersonal = false;
  
  formSucursales: string[] = []; 

  sucursalesDisponibles = [
    'Canindo', 'La Piedad Abastos', '8 Esquinas', 'Padre Hidalgo',
    'Morelia Madero', 'Morelia Abastos', 'Yurécuaro', 'Zamora Centro',
    'OFICINAS CORPORATIVAS', 'CAJA GENERAL', 'COMPRAS', 'CONTABILIDAD', 'FINANZAS', 'SISTEMAS', 'RH', 'MKT', 'MANTENIMIENTO'
  ];

  private auth = inject(Auth);
  private firestore = inject(Firestore); 
  private router = inject(Router); 
  private destructoresRadares: (() => void)[] = [];

  ngOnInit() {
    const sesion = localStorage.getItem('md_sesion_actual');
    if (sesion) { this.currentUser = JSON.parse(sesion); }
    this.conectarConLaNube();
  }

  ngOnDestroy() {
    this.destructoresRadares.forEach(apagarRadar => apagarRadar());
  }

  conectarConLaNube() {
    const usuariosRef = collection(this.firestore, 'usuarios');
    const radarPersonal = onSnapshot(usuariosRef, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return; 

      const usuariosNube: any[] = [];
      snapshot.forEach((documento) => {
        const data = documento.data();
        usuariosNube.push({ ...data, idFirestore: documento.id });
      });

      if (JSON.stringify(this.usuarios()) !== JSON.stringify(usuariosNube)) {
        this.usuarios.set(usuariosNube);
      }
    });
    this.destructoresRadares.push(radarPersonal);
  }

  getAdmins() { 
    return this.usuarios().filter(u => u.rol === 'admin' && 
      (u.nombre.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) || 
       u.cargo?.toLowerCase().includes(this.terminoBusqueda.toLowerCase())));
  }

  getTrabajadores() { 
    return this.usuarios().filter(u => u.rol === 'trabajador' && 
      (u.nombre.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) || 
       u.cargo?.toLowerCase().includes(this.terminoBusqueda.toLowerCase()) ||
       (u.sucursales && u.sucursales.join(' ').toLowerCase().includes(this.terminoBusqueda.toLowerCase()))));
  }

  getTrabajadoresAgrupados() {
    const trabajadores = this.getTrabajadores();
    const gruposMap = new Map<string, any[]>();
    trabajadores.forEach(user => {
      const nombreGrupo = user.sucursales?.length > 0 ? user.sucursales.join(' y ') : 'Sin Sucursal';
      if (!gruposMap.has(nombreGrupo)) gruposMap.set(nombreGrupo, []);
      gruposMap.get(nombreGrupo)!.push(user);
    });
    return Array.from(gruposMap.keys()).map(key => ({ nombre: key, usuarios: gruposMap.get(key)! }));
  }

  verHistorial(nombreEmpleado: string) {
    this.router.navigate(['/reportes'], { queryParams: { empleado: nombreEmpleado } });
  }

  abrirModal() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    this.usuarioEnEdicion = null;
    this.limpiarForm();
    this.isModalOpen = true;
  }

  limpiarForm() {
    this.formNombre = ''; this.formUsuario = ''; this.formCorreo = ''; this.formPassword = '';
    this.formRol = 'trabajador'; this.formCargo = 'Trabajador General'; 
    this.formPuedeCrearChecklists = false; 
    this.formPuedeCrearRutinas = false;      
    this.formPuedeCrearTareasUnicas = false; 
    this.formPuedeVerCheckstore = false; 
    this.formPuedeVerEstadisticas = false; 
    this.formPuedeVerHistorial = false; 
    this.formPuedeAdministrarPersonal = false; 
    this.formSucursales = [];
  }

  editarUsuario(user: any) {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    this.usuarioEnEdicion = user; 
    this.formNombre = user.nombre; this.formUsuario = user.usuario;
    this.formCorreo = user.correo || ''; this.formPassword = user.password || '';
    this.formRol = user.rol; this.formCargo = user.cargo || 'Trabajador General';
    this.formSucursales = user.sucursales ? [...user.sucursales] : [];
    
    // 🔥 CARGAR PERMISOS
    this.formPuedeCrearChecklists = !!user.puedeCrearChecklists;
    this.formPuedeCrearRutinas = !!user.puedeCrearRutinas;
    this.formPuedeCrearTareasUnicas = !!user.puedeCrearTareasUnicas;
    this.formPuedeVerCheckstore = !!user.puedeVerCheckstore;
    this.formPuedeVerEstadisticas = !!user.puedeVerEstadisticas;
    this.formPuedeVerHistorial = !!user.puedeVerHistorial; 
    this.formPuedeAdministrarPersonal = !!user.puedeAdministrarPersonal;
    
    this.isModalOpen = true;
  }

  cerrarModal() { this.isModalOpen = false; this.usuarioEnEdicion = null; }

  toggleSucursal(sucursal: string) {
    const index = this.formSucursales.indexOf(sucursal);
    if (index > -1) this.formSucursales.splice(index, 1);
    else this.formSucursales.push(sucursal);
  }

  async guardarUsuario() {
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return; 
    
    if (!this.formNombre || !this.formUsuario || !this.formPassword) {
      Swal.fire({ icon: 'warning', title: 'Datos Incompletos', text: 'Por favor completa el Nombre, Usuario y Contraseña.', confirmButtonColor: '#0F172A' });
      return;
    }
    
    if (!this.usuarioEnEdicion && !this.formCorreo) {
      Swal.fire({ icon: 'warning', title: 'Falta el Correo', text: 'Para crear un usuario nuevo el Correo Electrónico es obligatorio.', confirmButtonColor: '#0F172A' });
      return;
    }

    const payload = {
      nombre: this.formNombre, usuario: this.formUsuario, correo: this.formCorreo, password: this.formPassword,
      rol: this.formRol, cargo: this.formCargo,
      
      // 🔥 GUARDAR PERMISOS
      puedeCrearChecklists: this.formRol === 'admin' ? true : this.formPuedeCrearChecklists,
      puedeCrearRutinas: this.formRol === 'admin' ? true : this.formPuedeCrearRutinas,
      puedeCrearTareasUnicas: this.formRol === 'admin' ? true : this.formPuedeCrearTareasUnicas,
      puedeVerCheckstore: this.formRol === 'admin' ? true : this.formPuedeVerCheckstore,
      puedeVerEstadisticas: this.formRol === 'admin' ? true : this.formPuedeVerEstadisticas,
      puedeVerHistorial: this.formRol === 'admin' ? true : this.formPuedeVerHistorial,
      puedeAdministrarPersonal: this.formRol === 'admin' ? true : this.formPuedeAdministrarPersonal,
      sucursales: this.formRol === 'admin' ? ['General (Acceso Total)'] : this.formSucursales 
    };

    try {
      if (this.usuarioEnEdicion) {
        const docId = this.usuarioEnEdicion.idFirestore || this.usuarioEnEdicion.uid || this.usuarioEnEdicion.usuario;
        await setDoc(doc(this.firestore, 'usuarios', docId), payload, { merge: true });
      } else {
        const creds = await createUserWithEmailAndPassword(this.auth, this.formCorreo, this.formPassword);
        await setDoc(doc(this.firestore, 'usuarios', creds.user.uid), { ...payload, uid: creds.user.uid });
      }
      this.cerrarModal();
      Swal.fire({ icon: 'success', title: '¡Guardado!', text: 'El usuario se ha guardado en la nube correctamente.', confirmButtonColor: '#0F172A' });
    } catch (error: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#0F172A' });
    }
  }

async eliminarUsuario(userToDelete: any) {
    // Verificamos permisos básicos
    if (this.currentUser?.rol !== 'admin' && !this.currentUser?.puedeAdministrarPersonal) return;
    
    // Evitar que el usuario se borre a sí mismo
    if (userToDelete.usuario === this.currentUser.usuario) {
      Swal.fire({ icon: 'error', title: 'Acción no permitida', text: 'No puedes eliminar tu propio usuario.', confirmButtonColor: '#0F172A' });
      return;
    }

    // 🔥 1. CANDADO DE SEGURIDAD (Solo para Colaboradores) 🔥
    if (this.currentUser?.rol !== 'admin') {
      const { value: password } = await Swal.fire({
        title: 'Autenticación Requerida',
        text: 'Ingresa la contraseña maestra para autorizar la eliminación de este usuario:',
        input: 'password',
        inputPlaceholder: '••••••••',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#EF4444',
        cancelButtonColor: '#0F172A',
        confirmButtonText: 'Verificar',
        cancelButtonText: 'Cancelar'
      });

      // Si cerró el modal o le dio cancelar
      if (password === undefined) return; 

      // Verificamos la contraseña maestra
      if (password !== 'Mega2323') {
        Swal.fire({ icon: 'error', title: 'Clave Incorrecta', text: 'No tienes autorización para eliminar.', confirmButtonColor: '#0F172A' });
        return;
      }
    }

    // 2. Confirmación Final (Para todos, ya sea Admin o Colaborador autenticado)
    const result = await Swal.fire({
      title: `¿Eliminar a ${userToDelete.nombre}?`,
      text: "Esta acción borrará todos sus accesos al sistema y no se puede deshacer.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444',
      cancelButtonColor: '#0F172A',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      try {
        const docId = userToDelete.idFirestore || userToDelete.uid || userToDelete.usuario;
        await deleteDoc(doc(this.firestore, 'usuarios', docId));
        Swal.fire({ icon: 'success', title: 'Eliminado', text: 'El usuario fue borrado del sistema exitosamente.', confirmButtonColor: '#0F172A' });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Hubo un problema al intentar eliminar en la nube.', confirmButtonColor: '#0F172A' });
      }
    }
  }

  async descargarExcel() {
    const list = this.usuarios();
    if (list.length === 0) {
      Swal.fire({ icon: 'info', title: 'Lista Vacía', text: 'No hay personal para exportar.', confirmButtonColor: '#0F172A' });
      return;
    }

    // 1. 🔥 LA MAGIA: Pre-procesar y ORDENAR la lista por Zonas (Sucursales) 🔥
    const listaOrdenada = list.map(u => {
      const zona = u.sucursales ? (Array.isArray(u.sucursales) ? u.sucursales.join(' - ') : u.sucursales) : 'General';
      return { ...u, zonaCalculada: zona };
    }).sort((a, b) => a.zonaCalculada.localeCompare(b.zonaCalculada));

    // 2. Creamos el libro y la hoja
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personal MegaDulces');

    // 3. Definimos las columnas
    worksheet.columns = [
      { header: 'Nombre Completo', key: 'nombre', width: 35 },
      { header: 'Usuario', key: 'usuario', width: 20 },
      { header: 'Correo Electrónico', key: 'correo', width: 35 },
      { header: 'Rol', key: 'rol', width: 15 },
      { header: 'Cargo', key: 'cargo', width: 25 },
      { header: 'Sucursales', key: 'sucursales', width: 30 },
      { header: 'Crea Check', key: 'creaCheck', width: 12 },
      { header: 'Crea Rutinas', key: 'creaRutinas', width: 12 },
      { header: 'Crea Tareas', key: 'creaTareas', width: 12 },
      { header: 'Ve Store', key: 'veStore', width: 12 },
      { header: 'Ve Est.', key: 'veEst', width: 12 },
      { header: 'Ve Hist.', key: 'veHist', width: 12 },
      { header: 'Adm. Pers.', key: 'admPers', width: 12 }
    ];

    // 4. Diseño de Cabecera Principal (Navy Enterprise)
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' } 
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 30;

    // 5. 🔥 INYECTAMOS LOS DATOS CON FILAS SEPARADORAS DE GRUPO 🔥
    let zonaActual = '';

    listaOrdenada.forEach(u => {
      if (u.zonaCalculada !== zonaActual) {
        const separador = worksheet.addRow({ nombre: `📍 ZONA / DEPARTAMENTO: ${u.zonaCalculada.toUpperCase()}` });
        
        worksheet.mergeCells(`A${separador.number}:M${separador.number}`);
        
        separador.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        separador.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
        separador.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        separador.height = 25;
        
        zonaActual = u.zonaCalculada; 
      }

      worksheet.addRow({
        nombre: u.nombre || '-',
        usuario: u.usuario || '-',
        correo: u.correo || '-',
        rol: (u.rol || '').toUpperCase(),
        cargo: u.cargo || '-',
        sucursales: u.zonaCalculada,
        creaCheck: u.puedeCrearChecklists ? 'Sí' : 'No',
        creaRutinas: u.puedeCrearRutinas ? 'Sí' : 'No',
        creaTareas: u.puedeCrearTareasUnicas ? 'Sí' : 'No',
        veStore: u.puedeVerCheckstore ? 'Sí' : 'No',
        veEst: u.puedeVerEstadisticas ? 'Sí' : 'No',
        veHist: u.puedeVerHistorial ? 'Sí' : 'No',
        admPers: u.puedeAdministrarPersonal ? 'Sí' : 'No'
      });
    });

    // 6. Aplicamos el formato visual a las celdas (Bordes y Centrado)
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        
        if (rowNumber > 1) {
          const esSeparador = row.getCell(1).value?.toString().includes('📍 ZONA');
          
          if (!esSeparador) {
            if (colNumber >= 7 || colNumber === 4) {
              cell.alignment = { vertical: 'middle', horizontal: 'center' };
            } else {
              cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            }
          }
        }
      });
    });

    // 7. Generamos el archivo .xlsx
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Nomina_Personal_Agrupado.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error al exportar Personal:", error);
      Swal.fire({ icon: 'error', title: 'Error de Exportación', text: 'Hubo un error al generar el Excel de personal.', confirmButtonColor: '#0F172A' });
    }
  }

  togglePassword() {
    this.mostrarPassword = !this.mostrarPassword;
  }

}