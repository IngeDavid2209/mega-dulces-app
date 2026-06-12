-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('admin', 'trabajador');

-- CreateEnum
CREATE TYPE "Alcance" AS ENUM ('global', 'sucursales');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "uid_firebase" TEXT,
    "usuario" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "password_hash" TEXT,
    "cargo" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'trabajador',
    "alcance" "Alcance",
    "sucursales" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telefono" TEXT,
    "puede_crear_checklists" BOOLEAN NOT NULL DEFAULT false,
    "puede_crear_rutinas" BOOLEAN NOT NULL DEFAULT false,
    "puede_crear_tareas_unicas" BOOLEAN NOT NULL DEFAULT false,
    "puede_ver_checkstore" BOOLEAN NOT NULL DEFAULT false,
    "puede_ver_estadisticas" BOOLEAN NOT NULL DEFAULT false,
    "puede_ver_historial" BOOLEAN NOT NULL DEFAULT false,
    "puede_administrar_personal" BOOLEAN NOT NULL DEFAULT false,
    "puede_ver_calendario" BOOLEAN NOT NULL DEFAULT false,
    "puede_administrar_areas" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_latido" BIGINT,
    "ultima_edicion" BIGINT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "name" TEXT NOT NULL,
    "assigned" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_limite" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "archivado" BOOLEAN NOT NULL DEFAULT false,
    "archivado_mes" TEXT,
    "archivado_en" TIMESTAMP(3),
    "archivado_por" TEXT,
    "fotos_borradas" BOOLEAN NOT NULL DEFAULT false,
    "fotos_borradas_en" TIMESTAMP(3),
    "fotos_borradas_count" INTEGER,
    "nota_empleado" TEXT,
    "entrega_con_retraso" BOOLEAN NOT NULL DEFAULT false,
    "motivo_categoria" TEXT,
    "motivo_comentario" TEXT,
    "created_by" TEXT,
    "created_by_uid" TEXT,
    "timestamp_creacion" BIGINT,
    "_catalogo_rutina_id" TEXT,
    "_asignacion_id" TEXT,
    "_molde_id" TEXT,
    "mantenimiento" JSONB,
    "subtareas" JSONB DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "bloqueada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_bloqueo" DATE,
    "fecha_asignada" TEXT,
    "hora_entrada" TEXT,
    "hora_salida" TEXT,
    "turno_asignado" TEXT,
    "es_recurrente" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" TEXT,
    "fecha_modificacion" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rutinas_catalogo" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipo" TEXT,
    "frecuencia" TEXT,
    "dia_semana" TEXT,
    "dia_mes" INTEGER,
    "hora_inicio" TEXT,
    "hora_limite" TEXT,
    "responsable_sugerido" TEXT,
    "nivel_critico" TEXT,
    "evidencia" TEXT,
    "tiempo_estimado" INTEGER,
    "tareas" JSONB NOT NULL DEFAULT '[]',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" TEXT,
    "creado_en" BIGINT,
    "actualizado_por" TEXT,
    "actualizado_en" BIGINT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rutinas_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_rutinas" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "rutina_id" TEXT,
    "rutina_id_legacy" TEXT,
    "rutina_nombre" TEXT,
    "modo_asignacion" TEXT,
    "asignados" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rol_objetivo" TEXT,
    "store" TEXT,
    "area" TEXT,
    "frecuencia" TEXT,
    "dia_semana" TEXT,
    "dia_mes" INTEGER,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "hora_inicio" TEXT,
    "hora_limite" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asignaciones_rutinas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moldes_checklists" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "name" TEXT NOT NULL,
    "assigned" TEXT NOT NULL,
    "store" TEXT,
    "frecuencia" TEXT,
    "dia_semana" TEXT,
    "dia_mes" INTEGER,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "hora_inicio" TEXT,
    "hora_limite" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moldes_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas_equipo" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "jefe_equipo" TEXT,
    "integrantes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "store" TEXT,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "cerrado" BOOLEAN NOT NULL DEFAULT false,
    "fases" JSONB NOT NULL DEFAULT '[]',
    "timestamp_creacion" BIGINT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tareas_equipo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "usuario_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" BIGINT NOT NULL,
    "instrucciones" TEXT,
    "comentarios" TEXT,
    "adjunto" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tareas_unicas" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "usuario_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "completada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" BIGINT NOT NULL,
    "instrucciones" TEXT,
    "subtareas" JSONB NOT NULL DEFAULT '[]',
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tareas_unicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "empleado" TEXT NOT NULL,
    "empleado_uid" TEXT,
    "remitente" TEXT,
    "titulo" TEXT,
    "mensaje" TEXT,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_fcm" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "usuario_uid" TEXT,
    "user_agent" TEXT,
    "actualizado" BIGINT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tokens_fcm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descansos_semanales" (
    "id" TEXT NOT NULL,
    "doc_id_firebase" TEXT,
    "empleado" TEXT NOT NULL,
    "user_id" TEXT,
    "semana_iso" TEXT NOT NULL,
    "dias" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actualizado_por" TEXT,
    "actualizado_en" BIGINT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "descansos_semanales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_uid_firebase_key" ON "usuarios"("uid_firebase");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE INDEX "usuarios_rol_idx" ON "usuarios"("rol");

-- CreateIndex
CREATE INDEX "usuarios_alcance_idx" ON "usuarios"("alcance");

-- CreateIndex
CREATE UNIQUE INDEX "checklists_doc_id_firebase_key" ON "checklists"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "checklists_fecha_idx" ON "checklists"("fecha");

-- CreateIndex
CREATE INDEX "checklists_store_idx" ON "checklists"("store");

-- CreateIndex
CREATE INDEX "checklists_assigned_idx" ON "checklists"("assigned");

-- CreateIndex
CREATE INDEX "checklists_enviado_idx" ON "checklists"("enviado");

-- CreateIndex
CREATE INDEX "checklists_archivado_idx" ON "checklists"("archivado");

-- CreateIndex
CREATE INDEX "checklists_eliminado_idx" ON "checklists"("eliminado");

-- CreateIndex
CREATE INDEX "checklists_fecha_store_idx" ON "checklists"("fecha", "store");

-- CreateIndex
CREATE INDEX "checklists_assigned_fecha_idx" ON "checklists"("assigned", "fecha");

-- CreateIndex
CREATE INDEX "checklists__catalogo_rutina_id_idx" ON "checklists"("_catalogo_rutina_id");

-- CreateIndex
CREATE INDEX "checklists__asignacion_id_idx" ON "checklists"("_asignacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_doc_id_firebase_key" ON "areas"("doc_id_firebase");

-- CreateIndex
CREATE UNIQUE INDEX "areas_nombre_key" ON "areas"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "rutinas_catalogo_doc_id_firebase_key" ON "rutinas_catalogo"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "rutinas_catalogo_activa_idx" ON "rutinas_catalogo"("activa");

-- CreateIndex
CREATE UNIQUE INDEX "asignaciones_rutinas_doc_id_firebase_key" ON "asignaciones_rutinas"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "asignaciones_rutinas_activa_idx" ON "asignaciones_rutinas"("activa");

-- CreateIndex
CREATE INDEX "asignaciones_rutinas_store_idx" ON "asignaciones_rutinas"("store");

-- CreateIndex
CREATE INDEX "asignaciones_rutinas_rutina_id_idx" ON "asignaciones_rutinas"("rutina_id");

-- CreateIndex
CREATE UNIQUE INDEX "moldes_checklists_doc_id_firebase_key" ON "moldes_checklists"("doc_id_firebase");

-- CreateIndex
CREATE UNIQUE INDEX "tareas_equipo_doc_id_firebase_key" ON "tareas_equipo"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "tareas_equipo_jefe_equipo_idx" ON "tareas_equipo"("jefe_equipo");

-- CreateIndex
CREATE INDEX "tareas_equipo_cerrado_idx" ON "tareas_equipo"("cerrado");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_items_doc_id_firebase_key" ON "agenda_items"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "agenda_items_usuario_id_idx" ON "agenda_items"("usuario_id");

-- CreateIndex
CREATE INDEX "agenda_items_usuario_id_completada_idx" ON "agenda_items"("usuario_id", "completada");

-- CreateIndex
CREATE UNIQUE INDEX "tareas_unicas_doc_id_firebase_key" ON "tareas_unicas"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "tareas_unicas_usuario_id_idx" ON "tareas_unicas"("usuario_id");

-- CreateIndex
CREATE INDEX "tareas_unicas_usuario_id_completada_idx" ON "tareas_unicas"("usuario_id", "completada");

-- CreateIndex
CREATE UNIQUE INDEX "notificaciones_doc_id_firebase_key" ON "notificaciones"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "notificaciones_empleado_leido_idx" ON "notificaciones"("empleado", "leido");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_fcm_token_key" ON "tokens_fcm"("token");

-- CreateIndex
CREATE INDEX "tokens_fcm_usuario_idx" ON "tokens_fcm"("usuario");

-- CreateIndex
CREATE INDEX "tokens_fcm_usuario_uid_idx" ON "tokens_fcm"("usuario_uid");

-- CreateIndex
CREATE UNIQUE INDEX "descansos_semanales_doc_id_firebase_key" ON "descansos_semanales"("doc_id_firebase");

-- CreateIndex
CREATE INDEX "descansos_semanales_semana_iso_idx" ON "descansos_semanales"("semana_iso");

-- CreateIndex
CREATE UNIQUE INDEX "descansos_semanales_empleado_semana_iso_key" ON "descansos_semanales"("empleado", "semana_iso");

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_created_by_uid_fkey" FOREIGN KEY ("created_by_uid") REFERENCES "usuarios"("uid_firebase") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_rutinas" ADD CONSTRAINT "asignaciones_rutinas_rutina_id_fkey" FOREIGN KEY ("rutina_id") REFERENCES "rutinas_catalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tareas_unicas" ADD CONSTRAINT "tareas_unicas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
