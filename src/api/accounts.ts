import { Env, ArcaAccount, generateId, getCurrentTimestamp } from '../utils/db';
import { getAuthUser } from './auth';
import { encrypt } from '../utils/encryption';

export async function getArcaAccounts(request: Request, env: Env): Promise<Response> {
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const accounts = await env.DB.prepare(
      `SELECT 
        a.id, 
        a.user_id, 
        a.name, 
        a.provider, 
        a.cuit,
        CASE WHEN a.cert_encrypted IS NOT NULL AND a.cert_encrypted != '' THEN 1 ELSE 0 END as has_cert,
        CASE WHEN a.key_encrypted IS NOT NULL AND a.key_encrypted != '' THEN 1 ELSE 0 END as has_key,
        CASE WHEN a.afip_username_encrypted IS NOT NULL AND a.afip_username_encrypted != '' THEN 1 ELSE 0 END as has_credentials,
        a.created_at,
        bl.category as monotributo_category
      FROM arca_accounts a
      LEFT JOIN billing_limits bl ON a.id = bl.arca_account_id
      WHERE a.user_id = ?`
    ).bind(userId).all<any>();
    
    // Formatear respuesta con información de certificados
    const formattedAccounts = accounts.results.map((acc: any) => ({
      id: acc.id,
      name: acc.name,
      provider: acc.provider,
      cuit: acc.cuit,
      has_certificate: acc.has_cert === 1 && acc.has_key === 1,
      has_credentials: acc.has_credentials === 1,
      created_at: acc.created_at,
      monotributo_category: acc.monotributo_category || null
    }));
    
    return new Response(JSON.stringify({ accounts: formattedAccounts }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al obtener cuentas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Obtener una cuenta específica
export async function getArcaAccount(request: Request, env: Env, accountId: string): Promise<Response> {
  const userId = await getAuthUser(request, env);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const account = await env.DB.prepare(
      `SELECT 
        id, 
        user_id, 
        name, 
        provider, 
        cuit,
        CASE WHEN cert_encrypted IS NOT NULL AND cert_encrypted != '' THEN 1 ELSE 0 END as has_cert,
        CASE WHEN key_encrypted IS NOT NULL AND key_encrypted != '' THEN 1 ELSE 0 END as has_key,
        CASE WHEN afip_username_encrypted IS NOT NULL AND afip_username_encrypted != '' THEN 1 ELSE 0 END as has_credentials,
        created_at 
      FROM arca_accounts 
      WHERE id = ? AND user_id = ?`
    ).bind(accountId, userId).first<any>();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const formattedAccount = {
      id: account.id,
      name: account.name,
      provider: account.provider,
      cuit: account.cuit,
      has_certificate: account.has_cert === 1 && account.has_key === 1,
      has_credentials: account.has_credentials === 1,
      created_at: account.created_at
    };
    
    return new Response(JSON.stringify({ account: formattedAccount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al obtener cuenta' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Actualizar una cuenta ARCA
export async function updateArcaAccount(
  request: Request,
  env: Env,
  accountId: string,
  body: { 
    name?: string; 
    api_key?: string; 
    api_token?: string; 
    provider?: 'afip_sdk' | 'tusfacturas';
    cuit?: string;
    afip_username?: string;
    afip_password?: string;
    cert?: string;
    key?: string;
  }
): Promise<Response> {
  try {
    const userId = await getAuthUser(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Verificar que la cuenta existe y pertenece al usuario
    const existingAccount = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first<ArcaAccount>();
    
    if (!existingAccount) {
      return new Response(JSON.stringify({ error: 'Cuenta no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Construir query de actualización dinámicamente
    const updates: string[] = [];
    const values: any[] = [];
    
    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name);
    }
    
    if (body.provider !== undefined) {
      updates.push('provider = ?');
      values.push(body.provider);
    }
    
    if (body.api_key !== undefined) {
      const encryptedApiKey = await encrypt(body.api_key, env.ENCRYPTION_KEY);
      updates.push('api_key_encrypted = ?');
      values.push(encryptedApiKey);
    }
    
    if (body.api_token !== undefined) {
      if (body.api_token) {
        const encryptedToken = await encrypt(body.api_token, env.ENCRYPTION_KEY);
        updates.push('api_token_encrypted = ?');
        values.push(encryptedToken);
      } else {
        updates.push('api_token_encrypted = NULL');
      }
    }
    
    if (body.cuit !== undefined) {
      updates.push('cuit = ?');
      values.push(body.cuit || null);
    }
    
    if (body.afip_username !== undefined) {
      if (body.afip_username) {
        const encrypted = await encrypt(body.afip_username, env.ENCRYPTION_KEY);
        updates.push('afip_username_encrypted = ?');
        values.push(encrypted);
      } else {
        updates.push('afip_username_encrypted = NULL');
      }
    }
    
    if (body.afip_password !== undefined) {
      if (body.afip_password) {
        const encrypted = await encrypt(body.afip_password, env.ENCRYPTION_KEY);
        updates.push('afip_password_encrypted = ?');
        values.push(encrypted);
      } else {
        updates.push('afip_password_encrypted = NULL');
      }
    }
    
    if (body.cert !== undefined) {
      if (body.cert) {
        const encrypted = await encrypt(body.cert, env.ENCRYPTION_KEY);
        updates.push('cert_encrypted = ?');
        values.push(encrypted);
      } else {
        updates.push('cert_encrypted = NULL');
      }
    }
    
    if (body.key !== undefined) {
      if (body.key) {
        const encrypted = await encrypt(body.key, env.ENCRYPTION_KEY);
        updates.push('key_encrypted = ?');
        values.push(encrypted);
      } else {
        updates.push('key_encrypted = NULL');
      }
    }
    
    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No hay campos para actualizar' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    values.push(accountId);
    
    console.log(`[Update Account] Actualizando cuenta ${accountId} con campos:`, updates);
    console.log(`[Update Account] Número de valores:`, values.length);
    
    try {
      await env.DB.prepare(`
        UPDATE arca_accounts 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).bind(...values).run();
      
      console.log(`[Update Account] ✅ Cuenta ${accountId} actualizada correctamente`);
    } catch (dbError: any) {
      console.error(`[Update Account] ❌ Error en base de datos:`, dbError);
      throw new Error(`Error al actualizar en base de datos: ${dbError.message}`);
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Cuenta actualizada correctamente'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al actualizar cuenta' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function connectArcaAccount(
  request: Request,
  env: Env,
  body: { 
    name: string; 
    api_key: string; 
    api_token?: string; 
    provider: 'afip_sdk' | 'tusfacturas';
    cuit?: string;
    afip_username?: string;
    afip_password?: string;
    cert?: string;
    key?: string;
  }
): Promise<Response> {
  try {
    // Verificar autenticación
    const userId = await getAuthUser(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Para AFIP SDK: si hay api_token, usarlo como access token principal
    const accessToken = body.api_token || body.api_key;
    
    // Encriptar access token
    let encryptedApiKey: string;
    let encryptedToken: string | null = null;
    
    if (body.api_token) {
      encryptedToken = await encrypt(body.api_token, env.ENCRYPTION_KEY);
      encryptedApiKey = await encrypt(body.api_key || '', env.ENCRYPTION_KEY);
    } else {
      encryptedApiKey = await encrypt(accessToken, env.ENCRYPTION_KEY);
    }
    
    // Encriptar credenciales de AFIP si se proporcionan
    let encryptedAfipUsername: string | null = null;
    let encryptedAfipPassword: string | null = null;
    
    if (body.afip_username && body.afip_password) {
      encryptedAfipUsername = await encrypt(body.afip_username, env.ENCRYPTION_KEY);
      encryptedAfipPassword = await encrypt(body.afip_password, env.ENCRYPTION_KEY);
    }
    
    // Encriptar certificados si se proporcionan
    let encryptedCert: string | null = null;
    let encryptedPrivateKey: string | null = null;
    
    if (body.cert && body.key) {
      encryptedCert = await encrypt(body.cert, env.ENCRYPTION_KEY);
      encryptedPrivateKey = await encrypt(body.key, env.ENCRYPTION_KEY);
    }
    
    const accountId = generateId();
    const timestamp = getCurrentTimestamp();
    
    await env.DB.prepare(`
      INSERT INTO arca_accounts (id, user_id, name, api_key_encrypted, api_token_encrypted, cuit, afip_username_encrypted, afip_password_encrypted, cert_encrypted, key_encrypted, provider, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      accountId,
      userId,
      body.name,
      encryptedApiKey,
      encryptedToken,
      body.cuit || null,
      encryptedAfipUsername,
      encryptedAfipPassword,
      encryptedCert,
      encryptedPrivateKey,
      body.provider || 'afip_sdk',
      timestamp
    ).run();
    
    return new Response(JSON.stringify({ 
      success: true,
      account: {
        id: accountId,
        name: body.name,
        provider: body.provider || 'afip_sdk'
      }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Error al conectar cuenta' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

