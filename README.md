# Monitor Servicios Pronetsys — Fase 1 (Motor)

Herramienta in-house tipo UptimeRobot para monitorear la infraestructura de Pronetsys.
Esta primera fase entrega **únicamente el motor backend**: chequeo periódico de URLs,
registro de logs históricos y manejo del ciclo de vida de los incidentes.

> Fases posteriores: integración con la API de GLPI (apertura/cierre automático de
> tickets en `soporte.pronetsys.com.co/glpi`) y frontend en React + Tailwind para
> `monitor.pronetsys.com.co`.

---

## Stack

| Capa            | Tecnología                            |
| --------------- | ------------------------------------- |
| Runtime         | Node.js ≥ 18                          |
| Lenguaje        | TypeScript                            |
| Base de datos   | PostgreSQL                            |
| ORM             | Prisma 5                              |
| Cron            | `node-cron`                           |
| HTTP client     | `axios`                               |

---

## Estructura

```
monitor_servicios_pronetsys/
├── prisma/
│   ├── schema.prisma     # Esquema de datos (Service, Log, Incident)
│   └── seed.ts           # Servicios de ejemplo
├── src/
│   ├── config/env.ts     # Lectura tipada de variables de entorno
│   ├── db/prisma.ts      # Cliente Prisma singleton
│   ├── services/
│   │   ├── checker.ts        # Ejecuta el GET HTTP, clasifica errores de red
│   │   ├── stateManager.ts   # Transiciones UP/DOWN + apertura/cierre de incidentes
│   │   └── monitor.ts        # Orquestador del ciclo
│   ├── utils/logger.ts   # Logger con timestamp ISO
│   └── index.ts          # Entry point: arranca el cron
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Puesta en marcha — VPS Ubuntu 22.04 LTS (producción)

Hay dos scripts en [scripts/](scripts/) que automatizan todo el despliegue.

```bash
# 1) Subir el proyecto al VPS (desde tu maquina local)
scp -r ./monitor_servicios_pronetsys root@TU_VPS:/opt/

# 2) En el VPS, como root, dentro de la carpeta del proyecto
cd /opt/monitor_servicios_pronetsys
bash scripts/setup-ubuntu.sh        # instala Node 20 + Postgres + migracion
bash scripts/install-systemd.sh     # deja el motor corriendo como servicio
```

`setup-ubuntu.sh`:

- Instala Node.js 20 LTS desde NodeSource (la version de Ubuntu 22.04 default es muy vieja).
- Instala PostgreSQL 14 y habilita el servicio.
- Crea el rol `monitor` y la base `monitor_pronetsys` (idempotente).
- Genera el `.env` con un password aleatorio para Postgres.
- Ejecuta `npm install` + `prisma migrate`.

`install-systemd.sh`:

- Compila el TypeScript a `dist/`.
- Crea la unidad `/etc/systemd/system/monitor-pronetsys.service`.
- Reinicia automatico (`Restart=always`), inicia tras boot, logs via `journalctl`.

Comandos de operación una vez instalado:

```bash
systemctl status  monitor-pronetsys      # estado
systemctl restart monitor-pronetsys      # reinicio limpio
journalctl -u monitor-pronetsys -f       # tail de logs en vivo
journalctl -u monitor-pronetsys --since "1 hour ago"
```

## Puesta en marcha (PowerShell, Windows — solo desarrollo local)

```powershell
# 1) Instalar dependencias
npm install

# 2) Variables de entorno
Copy-Item .env.example .env
# editar .env y poner el DATABASE_URL real de PostgreSQL

# 3) Crear esquema en la base de datos
npx prisma migrate dev --name init

# 4) (opcional) Cargar servicios de ejemplo
npm run seed

# 5) Levantar el motor en modo desarrollo (recarga al guardar)
npm run dev

# o, para produccion:
npm run build
npm start
```

Comandos útiles:

| Comando                  | Que hace                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run dev`            | Arranca el motor con `ts-node-dev` (hot reload)                   |
| `npm run build`          | Compila a `dist/`                                                 |
| `npm start`              | Ejecuta el motor compilado                                        |
| `npm run prisma:studio`  | Abre Prisma Studio para inspeccionar/editar la BD en el navegador |
| `npm run prisma:migrate` | Crea/aplica una nueva migración                                   |
| `npm run seed`           | Inserta servicios de ejemplo                                      |

---

## Modelo de datos

- **Service** — Inventario de endpoints monitoreados.
  `id`, `nombre`, `url`, `intervaloMonitoreo` (minutos), `estadoActual` (`UP` /
  `DOWN` / `PAUSED`), `creadoEn`, `ultimoCheckEn`.
- **Log** — Registro histórico, una fila por cada chequeo.
  Guarda `latenciaMs`, `statusCode`, `errorMsg`, `timestamp`.
- **Incident** — Período de caída.
  Se abre cuando un servicio pasa de `UP` → `DOWN` y se cierra (rellenando
  `horaRecuperacion`) cuando vuelve a `UP`.

---

## Máquina de estados

```
   estado anterior   resultado    accion
   ---------------   ----------   ------------------------------------------------
   UP                ok           (sin cambios)
   UP                !ok          -> DOWN  + abrir Incident + alerta GLPI (stub)
   DOWN              ok           -> UP    + cerrar Incident abierto
   DOWN              !ok          (sin cambios — incidente sigue abierto)
   PAUSED            cualquiera   excluido del ciclo
```

Se considera **ok** cualquier respuesta con código HTTP en el rango `[200, 400)`.
Cualquier otra cosa (`>= 400`, timeout, DNS no resuelto, ECONNREFUSED, etc.) se
clasifica como caída.

Cuando se detecta una caída se emite en consola la línea:

```
[ALERTA] Preparando webhook para soporte.pronetsys.com.co/glpi...
```

Este es el punto de extensión donde se enganchará la llamada real a la API de
GLPI en la Fase 2.

---

## Integración con GLPI (Fase 2)

El motor abre tickets automáticamente en
`soporte.pronetsys.com.co/glpi` cuando un servicio cae, y los marca como
**Resueltos** cuando vuelve a responder OK.

### Configuración previa en GLPI

1. **Habilitar la API REST**
   `Configurar → General → API` → marcar *"Enable Rest API"*.

2. **Crear un App Client**
   En la misma pantalla → *Add API client* → permitir el rango de IP del VPS
   monitor → guardar. Copia el **App-Token** generado.

3. **Crear (o reutilizar) un usuario de servicio**
   Recomendado: un usuario propio tipo `bot-monitor` con perfil **Technician**
   y acceso a la entidad donde se abrirán los tickets.

4. **Generar User-Token**
   Entrar como ese usuario → *Settings → Personalization → Remote access keys*
   → *Regenerate API token* → copiarlo.

5. **Completar `.env`** en el VPS:

   ```bash
   GLPI_URL="https://soporte.pronetsys.com.co/glpi/apirest.php"
   GLPI_APP_TOKEN="..."     # del paso 2
   GLPI_USER_TOKEN="..."    # del paso 4
   GLPI_ENTITY_ID=0         # 0 = entidad raíz
   GLPI_DEFAULT_URGENCY=4   # 1-5 (5 = crítico)
   GLPI_AUTO_RESOLVE_AS=solved   # "solved" o "closed"
   ```

6. **Reiniciar el motor**:
   ```bash
   systemctl restart monitor-pronetsys
   ```

### Comportamiento

| Evento detectado            | Acción en GLPI                                                |
| --------------------------- | ------------------------------------------------------------- |
| Servicio UP → DOWN          | `POST /Ticket` con urgencia/impacto configurados              |
| Servicio sigue DOWN         | Sin acción (incidente único, no se duplica el ticket)         |
| Servicio DOWN → UP          | `POST /ITILSolution` + `PUT /Ticket/{id}` con status 5 ó 6    |
| Falla red/auth contra GLPI  | Se loguea como `[ERROR]`; el incidente queda registrado local |

El `glpi_ticket_id` queda guardado en la tabla `incidents`, así que aun
después de un reinicio del servicio el motor puede cerrar correctamente
los tickets de incidentes abiertos en ejecuciones anteriores.

### Si GLPI no está configurado

Si dejas vacío `GLPI_APP_TOKEN` o `GLPI_USER_TOKEN`, el motor sigue
funcionando normal: registra incidentes localmente y reproduce el stub
de Fase 1 (`[ALERTA] Preparando webhook para soporte.pronetsys.com.co/glpi...`).
Útil para entornos de staging.

---

## Frontend + API de lectura (Fase 3)

La Fase 3 añade dos piezas:

1. **API HTTP de lectura** (Fastify) embebida en el mismo proceso del motor.
   Expone JSON en `/api/*`. Corre en `127.0.0.1:3000` por defecto.
2. **Frontend** React + Vite + Tailwind en [frontend/](frontend/), servido
   como build estático por Nginx en `monitor.pronetsys.com.co`, con
   reverse-proxy de `/api` hacia el motor.

### Endpoints de la API

| Método | Ruta                              | Descripción                                  |
| ------ | --------------------------------- | -------------------------------------------- |
| GET    | `/api/health`                     | Healthcheck                                  |
| GET    | `/api/summary`                    | Conteos para las tarjetas (up/down/pausados) |
| GET    | `/api/services`                   | Lista de servicios + última latencia/status  |
| GET    | `/api/services/:id`               | Detalle de un servicio                       |
| GET    | `/api/services/:id/uptime?window=24h` | % uptime y stats de latencia (1h..30d)   |
| GET    | `/api/services/:id/logs?limit=100`| Histórico para el gráfico de latencia        |
| GET    | `/api/incidents?open=true`        | Incidentes (todos o sólo abiertos)           |

Probar la API directamente:

```bash
curl -s http://127.0.0.1:3000/api/summary | jq
curl -s http://127.0.0.1:3000/api/services | jq
```

### Desarrollo local del frontend

```bash
cd frontend
npm install
npm run dev          # Vite en http://localhost:5173
```

Vite proxea `/api` al motor en `:3000` (ver [frontend/vite.config.ts](frontend/vite.config.ts)),
así que el motor debe estar corriendo en paralelo (`npm run dev` en la raíz).

### Branding

- **Tipografía**: `Como W01 Bold` aplicada globalmente vía `@font-face` en
  [frontend/src/index.css](frontend/src/index.css). Es una fuente con licencia
  (Monotype): coloca el archivo en `frontend/public/fonts/ComoW01-Bold.woff2`.
  Si no está, cae a un stack sans-serif del sistema sin romper el render.
- **Logo**: en el encabezado se permite **sólo** el logotipo oficial. Coloca
  `frontend/public/logo.svg`. Si falta, muestra el texto "Pronetsys" como
  respaldo. No agregar otras imágenes al header
  (ver [frontend/src/components/Header.tsx](frontend/src/components/Header.tsx)).

### Despliegue en el VPS

```bash
# 1) Subir cambios (backend + frontend) desde tu PC
scp -r ./src ./frontend ./scripts ./package.json ./.env.example `
      root@MONITOR:/opt/monitor_servicios_pronetsys/

# 2) En el VPS — recompilar backend (ahora incluye la API)
cd /opt/monitor_servicios_pronetsys
npm install
npm run build
# añadir API_* al .env si quieres cambiar puerto/host (defaults: 127.0.0.1:3000)
systemctl restart monitor-pronetsys
curl -s http://127.0.0.1:3000/api/health    # debe responder {"ok":true,...}

# 3) Build del frontend
bash scripts/deploy-frontend.sh

# 4) Instalar Nginx y publicar el sitio
apt-get install -y nginx
cp scripts/nginx-monitor.conf /etc/nginx/sites-available/monitor.pronetsys.com.co
ln -s /etc/nginx/sites-available/monitor.pronetsys.com.co /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default     # opcional: quitar el site por defecto
nginx -t && systemctl reload nginx

# 5) HTTPS (tras apuntar el DNS de monitor.pronetsys.com.co al VPS)
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d monitor.pronetsys.com.co
```

Tras esto, el dashboard queda en `https://monitor.pronetsys.com.co` y el motor
sigue como servicio systemd sirviendo la API por detrás.

---

## Autenticación, gestión de servicios y alertas WhatsApp (Fase 4)

### Autenticación con roles

- Login con JWT guardado en **cookie httpOnly** (`@fastify/jwt` + `@fastify/cookie`).
- Roles: **ADMIN** (gestiona servicios) y **VIEWER** (solo lectura).
- Todas las rutas `/api/*` exigen sesión, excepto `/api/health` y `/api/auth/login`.
- Las rutas de escritura de servicios exigen rol ADMIN.

Endpoints de auth:

| Método | Ruta              | Descripción                          |
| ------ | ----------------- | ------------------------------------ |
| POST   | `/api/auth/login` | `{username, password}` → setea cookie |
| POST   | `/api/auth/logout`| Limpia la cookie                     |
| GET    | `/api/auth/me`    | Devuelve el usuario de la sesión     |

**Requisito**: `AUTH_JWT_SECRET` debe estar en `.env` o el motor no arranca.
Genéralo con `openssl rand -hex 32`.

Crear usuarios (CLI):

```bash
npm run user:create -- <username> <password> [admin|viewer]
# ejemplo primer admin:
npm run user:create -- admin "ClaveSegura123" admin
```

### Gestión de servicios (CRUD, solo ADMIN)

| Método | Ruta                        | Descripción                       |
| ------ | --------------------------- | --------------------------------- |
| POST   | `/api/services`             | Crear servicio                    |
| PUT    | `/api/services/:id`         | Editar nombre/objetivo/intervalo  |
| PATCH  | `/api/services/:id/estado`  | `{accion:"pause"\|"resume"}`      |
| DELETE | `/api/services/:id`         | Eliminar (borra logs/incidentes)  |

### Tipos de monitoreo: HTTP y TCP

Cada servicio tiene un `tipo`:

- **HTTP** (default): chequeo `GET` a una `url`; UP si responde `[200,400)`.
- **TCP**: intenta abrir una conexión a `host` + `puerto`; UP si el puerto
  acepta la conexión. Ideal para BD, SSH, SMTP, servicios internos, etc.

Cuerpo de ejemplo para crear cada tipo:

```jsonc
// HTTP
{ "nombre": "Portal", "tipo": "HTTP", "url": "https://www.pronetsys.com.co", "intervaloMonitoreo": 1 }
// TCP
{ "nombre": "PostgreSQL prod", "tipo": "TCP", "host": "10.0.0.5", "puerto": 5432, "intervaloMonitoreo": 1 }
```

En el dashboard, el formulario "Agregar servicio" tiene un selector
**Web (HTTP/HTTPS)** / **Puerto (TCP)** que muestra los campos correctos.

### Alertas WhatsApp (gateway OpenWA)

El motor envía WhatsApp al **caer** y al **recuperarse** un servicio, llamando
al gateway **OpenWA** (`rmyndharis/OpenWA`, NestJS + whatsapp-web.js):

```
POST {WHATSAPP_API_URL}/sessions/{WHATSAPP_SESSION_ID}/messages/send-text
Header: X-API-Key: {WHATSAPP_API_KEY}
Body:   { "chatId": "573001112233@c.us", "text": "..." }
```

Variables en `.env`:

```bash
WHATSAPP_ENABLED=true
WHATSAPP_API_URL="http://IP_DEL_SERVIDOR:2785/api"   # incluye /api, puerto 2785
WHATSAPP_API_KEY="<api key del gateway (data/.api-key)>"
WHATSAPP_SESSION_ID="<id/nombre de la sesion conectada>"
WHATSAPP_RECIPIENTS="573001112233,573004445566"
```

Requisitos previos en el gateway OpenWA:

1. Crear una sesión: `POST /api/sessions` → obtienes el `sessionId`.
2. Iniciarla: `POST /api/sessions/{sessionId}/start` y **escanear el QR**
   (`GET /api/sessions/{sessionId}/qr`) hasta que quede conectada.
3. La API key se autogenera en `data/.api-key` del gateway.

Probar sin esperar una caída:

```bash
npm run test:whatsapp
```

> OpenWA usa `whatsapp-web.js` (no oficial): corre una sesión de WhatsApp Web,
> puede desconectarse o implicar riesgo de baneo. La integración es tolerante a
> fallos: si el gateway no responde, se logea el error y el monitoreo continúa.

### Despliegue de la Fase 4 (backend)

```bash
# En el VPS, tras subir los cambios (src, scripts, package.json, prisma, .env.example)
cd /opt/monitor_servicios_pronetsys
npm install                                   # nuevas deps: jwt, cookie, bcryptjs

# .env: agregar AUTH_JWT_SECRET y (opcional) las vars WHATSAPP_*
echo "AUTH_JWT_SECRET=\"$(openssl rand -hex 32)\"" >> .env   # o editar a mano

npx prisma migrate dev --name add_users_roles  # crea la tabla users
npm run build
npm run user:create -- admin "TuClave" admin   # primer admin
systemctl restart monitor-pronetsys

# Verificar
curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"TuClave"}' -i   # debe devolver Set-Cookie
```

---

## Notas técnicas

- **Aislamiento por servicio**: cada chequeo se ejecuta con `Promise.allSettled`,
  de forma que un servicio que falle catastróficamente (DNS roto, TLS inválido)
  no detiene al resto del ciclo.
- **Anti-solape**: si un tick del cron empieza antes de que termine el anterior,
  el nuevo se omite con un `WARN` en el log. Evita bombardear la BD si los
  chequeos se ponen lentos.
- **Respeto al `intervaloMonitoreo` por servicio**: el cron corre cada minuto,
  pero internamente cada servicio sólo se chequea si su `ultimoCheckEn` ya
  superó su intervalo configurado. Así se puede tener servicios críticos a
  cada minuto y servicios menores a cada 5 / 10 minutos sin tocar el cron.
- **Idempotencia de incidentes**: nunca se abren dos incidentes simultáneos
  para el mismo servicio; si el chequeo falla y ya hay uno abierto, se ignora.
