# Arquitectura Cloudflare Pages + Workers + D1

Este documento describe las decisiones de arquitectura tomadas para proyectos basados en Cloudflare Pages, Workers y D1 Database. Útil como referencia para nuevos proyectos.

## Tabla de Contenidos

1. [Stack Tecnológico](#stack-tecnológico)
2. [Estructura del Proyecto](#estructura-del-proyecto)
3. [Configuración de Cloudflare](#configuración-de-cloudflare)
4. [Base de Datos D1](#base-de-datos-d1)
5. [Seguridad](#seguridad)
6. [Desarrollo Local vs Producción](#desarrollo-local-vs-producción)
7. [Deployment](#deployment)
8. [Migraciones de Base de Datos](#migraciones-de-base-de-datos)
9. [Variables de Entorno y Secrets](#variables-de-entorno-y-secrets)
10. [API Routing](#api-routing)
11. [Mejores Prácticas](#mejores-prácticas)

---

## Stack Tecnológico

### Frontend
- **HTML/CSS/JavaScript vanilla** - Sin frameworks pesados
- **Alpine.js** - Para reactividad ligera (CDN)
- **Tailwind CSS** - Para estilos (CDN en desarrollo, compilar en producción)
- **Chart.js** - Para gráficos (CDN)

### Backend
- **Cloudflare Pages Functions** - Serverless functions en edge
- **TypeScript** - Tipado estático
- **Cloudflare D1** - Base de datos SQLite distribuida
- **Cloudflare Workers Runtime** - V8 isolates en edge

### Infraestructura
- **Cloudflare Pages** - Hosting estático + Functions
- **Cloudflare D1** - Base de datos SQLite
- **GitHub** - Control de versiones y trigger de deploys

---

## Estructura del Proyecto

```
proyecto/
├── public/                    # Archivos estáticos (deploy a Pages)
│   ├── index.html
│   ├── js/                    # JavaScript del frontend
│   └── css/                   # Estilos
├── functions/                 # Cloudflare Pages Functions
│   └── api/
│       └── [[path]].ts        # Catch-all route para API
├── src/                       # Código TypeScript compartido
│   ├── api/                   # Handlers de API
│   └── utils/                 # Utilidades (db, encryption, etc)
├── migrations/                # Migraciones SQL de D1
│   ├── 0001_init.sql
│   └── ...
├── wrangler.toml              # Configuración de Wrangler (NO commitear)
├── .dev.vars                  # Variables locales (NO commitear)
├── package.json
└── tsconfig.json
```

### Decisiones Clave

1. **`public/` es el output directory** - Todo lo que está aquí se deploya como estático
2. **`functions/` contiene Pages Functions** - Se ejecutan en edge como serverless
3. **`src/` contiene código compartido** - Importado por Functions pero no deployado directamente
4. **Migraciones numeradas** - `0001_`, `0002_`, etc. para orden de ejecución

---

## Configuración de Cloudflare

### wrangler.toml

```toml
name = "nombre-proyecto"
compatibility_date = "2024-01-01"
pages_build_output_dir = "public"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "nombre-db"
database_id = "ID_DE_PRODUCCION"  # Obtener con: wrangler d1 create nombre-db
preview_database_id = "local"      # Para previews usar "local"

# KV Namespace (opcional)
# [[kv_namespaces]]
# binding = "CACHE"
# id = "KV_ID"
```

### Importante

- **`wrangler.toml` NO debe commitearse** - Contiene IDs específicos de producción
- Usar `wrangler.example.toml` como template
- Agregar `wrangler.toml` a `.gitignore`

---

## Base de Datos D1

### Crear Base de Datos

```bash
npx wrangler d1 create nombre-db
```

Esto devuelve un `database_id` que se agrega a `wrangler.toml`.

### Características

- **SQLite distribuido** - Misma sintaxis SQL que SQLite
- **Consistencia eventual** - Replicación global con latencia baja
- **Sin conexiones** - Se accede vía binding `env.DB`
- **Migraciones versionadas** - Sistema de versionado automático

### Acceso desde Código

```typescript
// En cualquier Pages Function
export async function onRequest(context: any) {
  const { env } = context;
  
  // Acceder a D1
  const result = await env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first();
  
  return new Response(JSON.stringify(result));
}
```

### Tipos TypeScript

```typescript
// src/utils/db.ts
export interface Env {
  DB: D1Database;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  // ... otros bindings
}
```

---

## Seguridad

### 1. Encriptación de Datos Sensibles

**Problema**: Credenciales de APIs externas deben almacenarse encriptadas.

**Solución**: Usar Web Crypto API con AES-GCM.

```typescript
// src/utils/encryption.ts
export async function encrypt(plaintext: string, key: string): Promise<string> {
  // AES-GCM con IV aleatorio
  // Retorna base64 string
}

export async function decrypt(ciphertext: string, key: string): Promise<string> {
  // Desencripta usando ENCRYPTION_KEY
}
```

**Uso**:
- Encriptar antes de guardar en DB: `encrypt(apiKey, env.ENCRYPTION_KEY)`
- Desencriptar al leer: `decrypt(encrypted, env.ENCRYPTION_KEY)`

### 2. Autenticación JWT

**Problema**: Necesitamos autenticación stateless para API.

**Solución**: JWT tokens firmados con secret.

```typescript
// src/api/auth.ts
import { sign, verify } from '@tsndr/cloudflare-worker-jwt';

// Generar token
const token = await sign({ userId, email }, env.JWT_SECRET);

// Verificar token
const payload = await verify(token, env.JWT_SECRET);
```

**Flujo**:
1. Usuario hace login → Backend genera JWT
2. Frontend guarda token en `localStorage`
3. Cada request incluye `Authorization: Bearer <token>`
4. Backend verifica token antes de procesar

### 3. Hash de Passwords

**Problema**: Passwords no deben almacenarse en texto plano.

**Solución**: SHA-256 (en producción considerar bcrypt o Argon2).

```typescript
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Nota**: SHA-256 es suficiente para Workers (sin bcrypt disponible), pero en producción considerar algoritmos más robustos si es posible.

### 4. Secrets Management

**NUNCA** commitear secrets en código:
- ✅ Usar `wrangler secret put` para producción
- ✅ Usar `.dev.vars` para desarrollo local (en `.gitignore`)
- ✅ Variables de entorno en Cloudflare Dashboard

---

## Desarrollo Local vs Producción

### Desarrollo Local

**Comando**:
```bash
npm run dev
# Equivale a:
npx wrangler pages dev public --compatibility-date=2024-01-01 --local
```

**Características**:
- Servidor local en `http://localhost:8788`
- Usa `.dev.vars` para variables de entorno
- Usa base de datos SQLite local (`.wrangler/state/v3/d1/`)
- Hot reload automático

**Configuración Local**:
```bash
# .dev.vars (NO commitear)
ENCRYPTION_KEY=clave-local-minimo-32-caracteres
JWT_SECRET=secret-local-minimo-32-caracteres
```

**Base de Datos Local**:
```bash
# Aplicar migraciones localmente
npx wrangler d1 migrations apply nombre-db --local

# Ejecutar SQL directamente
npx wrangler d1 execute nombre-db --local --command "SELECT * FROM users"
```

### Producción

**Deployment**:
- Automático vía GitHub hook (recomendado)
- Manual con `npm run deploy`

**Configuración**:
- Secrets configurados en Cloudflare Dashboard
- Base de datos D1 en producción (no local)
- Variables de entorno en Settings → Environment Variables

**Diferencias Clave**:

| Aspecto | Local | Producción |
|---------|-------|------------|
| Base de Datos | SQLite local | D1 distribuido |
| Variables | `.dev.vars` | Cloudflare Secrets |
| URL | `localhost:8788` | `proyecto.pages.dev` |
| Logs | Terminal | Cloudflare Dashboard |

---

## Deployment

### Opción 1: GitHub Hook (Recomendado)

**Configuración**:
1. Cloudflare Dashboard → Pages → Create Project
2. Conectar repositorio de GitHub
3. Configurar:
   - **Build command**: `npm ci` (o vacío si no hay build)
   - **Build output directory**: `public`
   - **Root directory**: `/` (raíz del repo)

**Flujo**:
- Push a `main` → Cloudflare detecta → Deploy automático
- No necesita GitHub Actions (evitar duplicación)

**Ventajas**:
- Deploy automático en cada push
- Preview deployments en PRs
- Rollback fácil desde dashboard

### Opción 2: Manual

```bash
# Deploy a producción
npm run deploy
# Equivale a:
npx wrangler pages deploy public
```

### Configuración de Build

**Si NO hay build step**:
- Build command: vacío
- Build output directory: `public`

**Si hay build step** (ej: compilar TypeScript):
- Build command: `npm run build`
- Build output directory: `dist` o `build`

### D1 Database Binding

**IMPORTANTE**: El binding de D1 debe configurarse manualmente en Cloudflare Dashboard:

1. Pages → Settings → Functions
2. D1 database bindings
3. Agregar binding:
   - Variable name: `DB`
   - D1 database: seleccionar base de datos

**Por qué**: `wrangler.toml` está en `.gitignore`, entonces Cloudflare no puede leerlo automáticamente.

---

## Migraciones de Base de Datos

### Estructura

```
migrations/
├── 0001_init.sql
├── 0002_add_feature.sql
└── 0003_fix_bug.sql
```

**Convención**:
- Numerar con `0001_`, `0002_`, etc.
- Nombres descriptivos: `add_feature`, `fix_bug`, etc.
- SQL puro, sin lógica de aplicación

### Aplicar Migraciones

**Local**:
```bash
npx wrangler d1 migrations apply nombre-db --local
```

**Producción**:
```bash
npx wrangler d1 migrations apply nombre-db --remote
```

**Ambos**:
```bash
npm run migrate
# (configurar script en package.json)
```

### Ejemplo de Migración

```sql
-- migrations/0002_add_feature.sql
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
```

### Mejores Prácticas

1. **Siempre usar `IF NOT EXISTS`** - Evita errores en re-ejecución
2. **Usar transacciones implícitas** - D1 maneja transacciones automáticamente
3. **Probar localmente primero** - Aplicar migraciones localmente antes de producción
4. **Backup antes de migraciones grandes** - Usar `wrangler d1 export`

---

## Variables de Entorno y Secrets

### Secrets (Sensibles)

**Producción**:
```bash
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put JWT_SECRET
```

**Local**:
```bash
# .dev.vars
ENCRYPTION_KEY=clave-local-32-chars-min
JWT_SECRET=secret-local-32-chars-min
```

### Variables de Entorno (No Sensibles)

**Producción**: Cloudflare Dashboard → Pages → Settings → Environment Variables

**Local**: `.dev.vars` (mismo formato)

### Tipos de Variables

| Tipo | Uso | Ejemplo |
|------|-----|---------|
| Secret | Credenciales, keys | `ENCRYPTION_KEY`, `JWT_SECRET` |
| Environment Variable | Configuración | `API_URL`, `FEATURE_FLAG` |

### Acceso desde Código

```typescript
export async function onRequest(context: any) {
  const { env } = context;
  
  // Secrets y variables están en env
  const key = env.ENCRYPTION_KEY;
  const apiUrl = env.API_URL;
}
```

---

## API Routing

### Estructura

**Catch-all route**: `functions/api/[[path]].ts`

```typescript
export async function onRequest(context: any): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  // Routing manual
  if (path === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }
  
  if (path.startsWith('/api/users')) {
    return handleUsers(request, env);
  }
  
  return new Response('Not Found', { status: 404 });
}
```

### CORS Headers

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Handle preflight
if (request.method === 'OPTIONS') {
  return new Response(null, { headers: corsHeaders });
}

// Agregar a todas las respuestas
return new Response(body, {
  status: 200,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

### Autenticación

```typescript
async function getAuthUser(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  const { verifyToken } = await import('../api/auth');
  const result = await verifyToken(env, token);
  return result?.userId || null;
}
```

---

## Mejores Prácticas

### 1. Estructura de Código

- **Separar concerns**: `src/api/` para handlers, `src/utils/` para utilidades
- **Tipos compartidos**: Definir interfaces en `src/utils/db.ts`
- **No duplicar lógica**: Reutilizar funciones entre endpoints

### 2. Manejo de Errores

```typescript
try {
  // Lógica
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
} catch (error: any) {
  console.error('[ERROR] Operation failed:', error);
  return new Response(JSON.stringify({ 
    error: 'Error interno del servidor',
    message: error.message 
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### 3. Logging

```typescript
// Debug logging (útil en desarrollo)
console.log('[DEBUG] Operation:', { userId, accountId });

// Error logging (siempre)
console.error('[ERROR] Failed:', error.message, error.stack);
```

**Ver logs**:
- Local: Terminal donde corre `wrangler pages dev`
- Producción: Cloudflare Dashboard → Pages → Logs

### 4. Testing Local

```bash
# Servidor con logs detallados
npm run dev:verbose

# Verificar base de datos local
npx wrangler d1 execute nombre-db --local --command "SELECT * FROM users"
```

### 5. Gitignore

**Siempre ignorar**:
```
.env
.env.local
.dev.vars
wrangler.toml
*.pem
*.key
*.crt
.wrangler/
node_modules/
```

### 6. TypeScript

**Configuración recomendada** (`tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true
  }
}
```

### 7. Dependencias

**Minimizar dependencias**:
- Workers tiene límites de tamaño
- Preferir APIs nativas cuando sea posible
- Usar CDN para librerías del frontend

**Dependencias comunes**:
- `@cloudflare/workers-types` - Tipos TypeScript
- `@tsndr/cloudflare-worker-jwt` - JWT (si se necesita)
- `wrangler` - CLI (devDependency)

---

## Checklist de Setup Inicial

Para un nuevo proyecto:

- [ ] Crear repositorio GitHub
- [ ] Crear proyecto en Cloudflare Pages
- [ ] Conectar GitHub a Cloudflare Pages
- [ ] Crear base de datos D1: `npx wrangler d1 create nombre-db`
- [ ] Configurar `wrangler.toml` con database_id
- [ ] Crear `.dev.vars` para desarrollo local
- [ ] Configurar secrets en producción: `wrangler secret put`
- [ ] Crear primera migración: `migrations/0001_init.sql`
- [ ] Aplicar migraciones: `npm run migrate`
- [ ] Configurar D1 binding en Cloudflare Dashboard
- [ ] Crear `functions/api/[[path]].ts` para routing
- [ ] Probar localmente: `npm run dev`
- [ ] Hacer primer deploy: push a `main`

---

## Troubleshooting

### "No routes found when building Functions directory"

**Causa**: `functions/api/[[path]].ts` está vacío o no existe.

**Solución**: Crear el archivo con `export async function onRequest(...)`.

### "D1 binding not available"

**Causa**: Binding no configurado en Cloudflare Dashboard.

**Solución**: Pages → Settings → Functions → D1 database bindings → Agregar.

### "Secret not found"

**Causa**: Secret no configurado en producción.

**Solución**: `npx wrangler secret put SECRET_NAME` o configurar en Dashboard.

### Base de datos local diferente a producción

**Causa**: Migraciones no aplicadas o datos diferentes.

**Solución**: 
- Aplicar migraciones localmente: `npm run migrate -- --local`
- Verificar datos: `wrangler d1 execute nombre-db --local --command "SELECT * FROM tabla"`

### Deploy falla pero local funciona

**Causa**: Variables de entorno o secrets faltantes en producción.

**Solución**: Verificar todos los secrets en Cloudflare Dashboard.

---

## Recursos

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)

---

**Última actualización**: Enero 2025

