# Configuración de OpenWA — Guía de instalación y vinculación de WhatsApp

> Resumen del proceso completo para instalar OpenWA (gateway/API REST para WhatsApp basado en whatsapp-web.js + NestJS) en un servidor Docker y vincular una sesión de WhatsApp.
>
> Servidor: `10.0.0.35` · Ruta del proyecto: `/home/pronetsys/OpenWA`

---

## 1. Qué es OpenWA

OpenWA es un **gateway/API REST open source para WhatsApp**. Permite controlar WhatsApp (crear sesiones, enviar/recibir mensajes) vía llamadas HTTP y WebSocket.

| Capa | Tecnología |
| --- | --- |
| Runtime | Node.js 20 LTS |
| Framework | NestJS 11.x |
| Motor WhatsApp | whatsapp-web.js |
| WebSocket | Socket.IO |
| Base de datos | SQLite (default) / PostgreSQL |
| Contenedor | Docker + Docker Compose |

**Hallazgo importante:** aunque el README del repo menciona un dashboard web en el puerto `2886` (con Traefik), el `docker-compose.yml` real **solo define el servicio `openwa-api`**. No hay dashboard separado. La interfaz real es **Swagger** (`/api/docs`) y las llamadas a la API. El puerto 2886 no existe en este repo.

> ⚠️ **Aviso:** OpenWA usa whatsapp-web.js, que automatiza WhatsApp de forma **no oficial** (no es la API de WhatsApp Business). WhatsApp puede banear números detectados como automatizados. Para producción conviene un número desechable o evaluar la API oficial.

---

## 2. Instalación con Docker

```bash
cd /home/pronetsys/OpenWA
docker compose up -d
docker compose ps
```

### Problema encontrado: la API solo escuchaba en localhost

El mapeo inicial era `127.0.0.1:2785->2785/tcp`, lo que impedía el acceso desde la red. Se editó el `docker-compose.yml` quitando el prefijo `127.0.0.1:`:

```yaml
# Antes
ports:
  - "127.0.0.1:2785:2785"

# Después
ports:
  - "2785:2785"
```

Luego se recargó:

```bash
docker compose down
docker compose up -d
docker compose ps
```

Resultado correcto — el puerto queda accesible desde la red:

```
PORTS
0.0.0.0:2785->2785/tcp
```

---

## 3. Verificación de que la API funciona

```bash
docker compose config --services      # debe listar: openwa-api
curl -I http://localhost:2785/         # devuelve 404 (no hay dashboard, es normal)
curl -I http://localhost:2785/api/health   # debe devolver 200 OK
```

La raíz `/` da **404** porque no hay dashboard embebido. El **404 es esperado**; lo importante es que `/api/health` responda `200 OK`:

```json
{"status":"ok","timestamp":"2026-05-29T15:20:50.195Z"}
```

### Accesos
- **API:** `http://10.0.0.35:2785/api`
- **Swagger (doc interactiva):** `http://10.0.0.35:2785/api/docs`
- **Health:** `http://10.0.0.35:2785/api/health`

---

## 4. Obtener la API Key

OpenWA genera una API key automática en el primer arranque y la guarda en `data/.api-key`. Con Docker se lee dentro del contenedor:

```bash
docker compose exec openwa-api cat /app/data/.api-key
```

> 🔒 **Seguridad:** la API key da control total sobre WhatsApp. No subirla a repos ni compartirla. Si se expone, regenerarla.

---

## 5. Variables de entorno útiles

Para no repetir la key y la URL base en cada comando:

```bash
KEY="owa_k1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
BASE="http://localhost:2785/api"
```

> Si abres una terminal nueva, estas variables se pierden y hay que volver a definirlas.

---

## 6. Flujo para vincular WhatsApp (sesión)

### Paso 1 — Crear la sesión

```bash
curl -s -X POST $BASE/sessions \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"name": "my-bot"}'
```

> ⚠️ **El nombre tiene validación.** Nombres con guion bajo (ej: `prueba_pronetsys`) devuelven `400 Bad Request`. Usar nombres simples como `my-bot`.

Respuesta:

```json
{
  "id": "cd30bb98-7b9c-4795-b17d-cc91ba04d7a5",
  "name": "my-bot",
  "status": "created",
  ...
}
```

Guardar el `id` (es el `sessionId`).

### Paso 2 — Iniciar la sesión

```bash
SID="cd30bb98-7b9c-4795-b17d-cc91ba04d7a5"
curl -s -X POST $BASE/sessions/$SID/start -H "X-API-Key: $KEY"
```

El estado pasa por: `created` → `initializing` → `qr_ready`.

### Paso 3 — Obtener el QR

```bash
curl -s $BASE/sessions/$SID/qr -H "X-API-Key: $KEY"
```

Devuelve el QR como **imagen PNG en base64** (data-URI):

```json
{"qrCode":"data:image/png;base64,iVBORw0KGgo...","status":"qr_ready"}
```

### Paso 4 — Verificar conexión tras escanear

```bash
curl -s $BASE/sessions/$SID -H "X-API-Key: $KEY"
```

Buscar que `status` pase a `connected`/`ready` y que `phone` muestre el número.

---

## 7. El problema del QR y su solución

### Síntoma
- "QR inválido" al escanear, o el QR se generaba mal.

### Causas
1. **Caducidad:** los QR de WhatsApp Web rotan cada ~20 segundos. Entre generar, descargar y abrir WhatsApp, el QR expiraba.
2. **Renderizado en terminal:** intentar mostrar el QR con `chafa` en la consola SSH lo hacía ilegible (el antialiasing y la escala de grises destruyen los bordes nítidos que el QR necesita).

### Intentos que NO funcionaron bien
- `chafa qr.png` → ilegible por antialiasing.
- `qrencode` → requiere el **texto** del QR, pero la API solo entrega **imagen base64**, no el string.
- Descargar con `scp` → funciona pero hay que ganar la carrera contra el caduque de 20 seg.

### Solución definitiva: página HTML auto-refrescante

Una página web local que consulta el endpoint del QR automáticamente cada 5 segundos, lo muestra grande y nítido, y detecta cuando la sesión se conecta. Esto elimina la carrera contra el caduque.

**Requisito:** que la PC alcance la API en `http://10.0.0.35:2785/api/health` (confirmado ✅).

La página incluye:
- Refresco automático del QR cada 5 segundos.
- Detección de estado `connected`/`ready` → muestra ✅ y detiene el refresco.
- Instrucciones de escaneo.

> ⚠️ El HTML lleva la API key en texto plano. Es solo para uso local durante la vinculación. No compartir ni subir a repos.

**Posible tropiezo — CORS:** si el navegador bloquea las peticiones (error "blocked by CORS policy" en la consola F12), hay que servir el HTML desde el propio servidor o con un mini servidor local en lugar de abrirlo como archivo `file://`.

---

## 8. Enviar mensajes (una vez vinculado)

```bash
curl -s -X POST $BASE/sessions/$SID/messages/send-text \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"chatId": "573503950538@c.us", "text": "Hola desde OpenWA"}'
```

- El `chatId` es el número con **código de país (sin +)** seguido de `@c.us`.
- Ejemplo Colombia: `573503950538@c.us`.

---

## 9. Recibir mensajes (eventos en tiempo real)

OpenWA expone eventos por **WebSocket (Socket.IO)** en `/events` y soporta **webhooks con firma HMAC**.

```javascript
import { io } from 'socket.io-client';

const socket = io('http://10.0.0.35:2785/events', {
  extraHeaders: { 'X-API-Key': 'tu-api-key' },
  transports: ['websocket'],
});

socket.on('connect', () => {
  socket.emit('message', {
    type: 'subscribe',
    sessionId: 'cd30bb98-7b9c-4795-b17d-cc91ba04d7a5',
    events: ['message.received', 'session.status'],
    requestId: 'req_001',
  });
});

socket.on('message', msg => {
  if (msg.type === 'event') {
    console.log('Event:', msg.payload.event, msg.payload.data);
  }
});
```

### Integración con n8n
El repo incluye un doc específico de [integración con n8n](https://github.com/rmyndharis/OpenWA/blob/main/docs/22-n8n-integration.md) con nodos de comunidad. Para producción, lo natural es conectar OpenWA a n8n por webhooks y olvidar el curl manual.

---

## 10. Comandos de diagnóstico útiles

```bash
# Estado de contenedores y puertos
docker compose ps

# Logs de la API
docker compose logs --tail=80 openwa-api

# Confirmar qué servicios define el compose
docker compose config --services

# Ver qué escucha en el puerto
sudo ss -tlnp | grep 2785

# Probar la API localmente desde el servidor
curl -I http://localhost:2785/api/health
```

---

## 11. Pendientes / mejoras recomendadas

- [ ] Vincular la sesión escaneando el QR desde la página HTML.
- [ ] Activar **whitelisting por CIDR** y **rate limiting** (OpenWA los soporta) ya que la API queda expuesta en la red.
- [ ] Poner la API detrás de **Nginx Proxy Manager** con dominio y SSL en lugar de exponer `IP:puerto` directo.
- [ ] Configurar webhooks hacia **n8n** para automatizar flujos.
- [ ] Regenerar la API key si se expuso durante las pruebas.

---

*Documento generado el 2026-05-29 · PRONETSYS S.A.S.*
