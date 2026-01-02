# ARCA Dashboard

Webapp responsive para gestionar múltiples cuentas ARCA, con dashboard de facturación, emisión/edición de comprobantes, y alertas de límites de monotributo.

## Arquitectura

- **Frontend**: HTML/CSS/JavaScript vanilla con Alpine.js
- **Backend**: Cloudflare Workers (TypeScript)
- **Base de Datos**: Cloudflare D1 (SQLite)
- **Integración ARCA**: AFIP SDK o TusFacturasApp (SaaS)

## Configuración Inicial

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar Cloudflare

1. Crear una cuenta en [Cloudflare](https://cloudflare.com)
2. Instalar Wrangler CLI (ya incluido en dependencias)
3. Autenticarse:
   ```bash
   npx wrangler login
   ```

### 3. Crear Base de Datos D1

```bash
npx wrangler d1 create arca-db
```

Esto mostrará un `database_id`. Copiarlo y agregarlo en `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "arca-db"
database_id = "TU_DATABASE_ID_AQUI"
```

### 4. Ejecutar Migraciones

```bash
npm run migrate
```

### 5. Configurar Secrets

```bash
# Secret para encriptar credenciales ARCA
npx wrangler secret put ENCRYPTION_KEY

# Secret para JWT tokens
npx wrangler secret put JWT_SECRET

# API Key de AFIP SDK o TusFacturasApp (opcional, se puede configurar por cuenta)
npx wrangler secret put AFIP_SDK_API_KEY
# o
npx wrangler secret put TUSFACTURAS_API_KEY
```

## Desarrollo Local

1. Crear archivo `.dev.vars` para variables de entorno locales:
```bash
cp .dev.vars.example .dev.vars
# Editar .dev.vars con tus valores
```

2. Iniciar servidor de desarrollo:
```bash
npm run dev
``` 

Esto iniciará un servidor local en `http://localhost:8788` (puerto por defecto de Pages)

## Despliegue

### Despliegue Automático con GitHub Actions

El proyecto está configurado para desplegarse automáticamente a Cloudflare Pages cuando haces push a la rama `main`.

**Ver [DEPLOY.md](DEPLOY.md) para instrucciones completas de configuración inicial.**

### Despliegue Manual

```bash
# Desplegar frontend a Cloudflare Pages
npm run deploy

# Aplicar migraciones de base de datos
npm run migrate
```

### Configuración de Producción

1. Configurar secrets en Cloudflare Dashboard (Variables and Secrets)
2. Configurar secrets en GitHub (Settings > Secrets and variables > Actions)
3. Ver [DEPLOY.md](DEPLOY.md) para detalles completos

## Uso

1. Acceder a la aplicación
2. Registrarse o iniciar sesión
3. Conectar una cuenta ARCA (AFIP SDK o TusFacturasApp):
   - Ir a configuración
   - Agregar nueva cuenta con API key
4. Configurar categoría de monotributo
5. Gestionar facturas (emitir facturas temporalmente deshabilitado - se probará desde desarrollo de AFIP)

## Estructura del Proyecto

```
arca-gus/
├── public/              # Frontend estático
│   ├── index.html       # Dashboard
│   ├── login.html       # Login/Registro
│   ├── invoices.html    # Gestión facturas
│   ├── css/            # Estilos
│   └── js/             # JavaScript
├── src/                 # Cloudflare Workers
│   ├── index.ts        # Worker principal
│   ├── api/            # Endpoints API
│   └── utils/          # Utilidades
├── migrations/          # Migraciones D1
└── wrangler.toml       # Config Cloudflare
```

## API Endpoints

- `POST /api/auth/register` - Registro
- `POST /api/auth/login` - Login
- `GET /api/arca/accounts` - Listar cuentas ARCA
- `POST /api/arca/connect` - Conectar cuenta ARCA
- `GET /api/invoices?account_id=xxx` - Listar facturas
- `POST /api/invoices` - Emitir factura (temporalmente deshabilitado)
- `PATCH /api/invoices/:id` - Actualizar factura
- `GET /api/invoices/:id/pdf` - Descargar PDF
- `GET /api/limits?account_id=xxx` - Obtener límites
- `POST /api/limits` - Configurar límites

## Notas

- Los límites de monotributo están hardcodeados en `src/api/limits.ts` y deben actualizarse según la normativa vigente
- Las APIs de AFIP SDK y TusFacturasApp pueden tener endpoints diferentes. Ajustar en `src/api/arca.ts` según la documentación oficial
- En producción, considerar usar Cloudflare Access para autenticación adicional

## Límites Plan Gratuito Cloudflare

- **Pages**: Ilimitado
- **Workers**: 100,000 requests/día
- **D1**: 5GB, 5M reads/mes, 100k writes/mes

## Licencia

MIT

