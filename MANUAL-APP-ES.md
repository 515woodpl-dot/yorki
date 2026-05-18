# Manual de Yorki

## Qué hace Yorki

Yorki es una aplicación interna para gestionar solicitudes, tareas y seguimiento del trabajo del equipo.

Funciones principales:
- crear solicitudes nuevas
- asignar tareas a usuarios internos
- mover tareas entre columnas del tablero
- editar detalles de la tarea
- agregar comentarios
- subir archivos adjuntos
- archivar tareas completadas
- enviar correos automáticos
- sincronizar tareas con Google Calendar cuando se activa esa opción

## Flujo general

1. Un usuario crea una solicitud.
2. La tarea entra al tablero.
3. Se puede asignar a una persona.
4. Se puede definir prioridad, fecha, dirección y checklist.
5. El equipo trabaja la tarea y la mueve entre columnas.
6. Cuando termina, se marca como completada.
7. Las tareas completadas pueden archivarse manualmente o por proceso automático.

## Qué puede hacer Staff

El rol `staff` está pensado para usuarios operativos.

Permisos de staff:
- iniciar sesión
- ver sus tareas asignadas
- crear solicitudes nuevas
- agregar comentarios
- ver adjuntos de sus tareas
- editar ciertos detalles de tareas propias o asignadas, según la lógica actual

Limitaciones de staff:
- no administra usuarios
- no administra columnas
- no administra configuraciones generales
- no elimina tareas
- no entra al panel administrativo completo

## Qué puede hacer Admin

El rol `admin` tiene control operativo completo de Yorki.

Permisos de admin:
- todo lo que puede hacer staff
- ver el tablero completo
- mover tareas entre columnas
- cambiar prioridad
- completar, reabrir, archivar y eliminar tareas
- crear usuarios
- cambiar roles
- activar o desactivar usuarios
- asignar o cambiar contraseñas
- eliminar usuarios cuando no tienen historial bloqueante
- administrar columnas
- administrar ajustes de correo
- administrar configuraciones generales
- ver archivo de tareas
- ver actividad del sistema

## Qué hace el formulario de solicitud

Desde `Submit`, el usuario puede:
- escribir título y descripción
- seleccionar prioridad
- seleccionar persona asignada
- agregar fecha y hora
- agregar dirección
- crear checklist
- subir archivos
- activar la opción de enviar la tarea a Google Calendar

Si la tarea tiene correo de usuario asignado, Yorki puede enviar notificación por email.

## Qué hace el panel de tarea

Dentro de una tarea se puede:
- ver estado y prioridad
- cambiar asignación
- mover la tarea a otra columna
- editar descripción
- editar dirección
- editar fecha y hora
- editar checklist
- ver adjuntos
- agregar comentarios
- completar, reabrir, archivar o eliminar según permisos

## Correos automáticos

Yorki puede enviar correos para:
- nueva solicitud
- tarea compartida o asignada
- tarea completada
- invitación de usuario

Actualmente el envío usa Resend.

## Google Calendar

Si se activa la casilla de calendario al crear o editar una tarea:
- Yorki intenta crear o actualizar un evento en Google Calendar
- el evento incluye título, fecha, hora, dirección y descripción
- el nombre del usuario asignado se agrega en la descripción

Nota:
- la invitación como attendee de Google no se usa actualmente
- la notificación al usuario se hace por email desde Yorki

## Adjuntos

Los archivos adjuntos se guardan en la carpeta pública de uploads del sistema.

Tipos de uso:
- imágenes
- documentos
- archivos de soporte

Los adjuntos quedan ligados a la tarea correspondiente.

## Archivo automático

Las tareas completadas pueden pasar al archivo automáticamente.

Regla prevista:
- todos los viernes a las 9:00 PM, hora de Seattle

Esto se ejecuta con un script del servidor y un cron job.

## Respaldo

La base de datos SQLite debe vivir fuera de la carpeta de despliegue para no perderse en rebuilds.

Ruta recomendada:
- `/var/lib/yorki/yorki.db`

Respaldo recomendado:
- `rclone` a Google Drive
- tres veces al día

## Resumen de roles

- `staff`: ejecuta y da seguimiento a su trabajo
- `admin`: administra la operación completa de Yorki
