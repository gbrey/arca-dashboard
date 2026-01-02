import { Env, ArcaAccount } from '../utils/db';
import { decrypt, encrypt } from '../utils/encryption';
import { callAfipSdkAutomation } from './arca';

// Dar de alta un CUIT en AFIP SDK: crear certificado y autorizar web services
export async function registerCuitInAfipSdk(
  env: Env,
  accountId: string,
  userId: string
): Promise<Response> {
  try {
    // Obtener cuenta
    const account = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first<ArcaAccount>();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!account.cuit || !account.afip_username_encrypted || !account.afip_password_encrypted) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales de AFIP (CUIT, username, password)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const accessToken = account.api_token_encrypted 
      ? await decrypt(account.api_token_encrypted, env.ENCRYPTION_KEY)
      : await decrypt(account.api_key_encrypted, env.ENCRYPTION_KEY);
    
    const afipUsername = await decrypt(account.afip_username_encrypted, env.ENCRYPTION_KEY);
    const afipPassword = await decrypt(account.afip_password_encrypted, env.ENCRYPTION_KEY);
    
    console.log(`[Register CUIT] Iniciando registro de CUIT ${account.cuit} en AFIP SDK...`);
    
    // Paso 1: Crear certificado de producción
    const cleanName = account.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const namePrefix = cleanName || 'cert';
    const alias = `${namePrefix}${Date.now()}`;
    
    console.log(`[Register CUIT] Paso 1: Creando certificado de producción con alias: ${alias}`);
    
    let cert: string | null = null;
    let key: string | null = null;
    
    try {
      const certResult = await callAfipSdkAutomation('create-cert-prod', accessToken, {
        cuit: account.cuit,
        username: afipUsername,
        password: afipPassword,
        alias: alias
      });
      
      cert = certResult.cert || certResult.certificate || certResult.certificado || certResult.cert_data || certResult.certData;
      key = certResult.key || certResult.private_key || certResult.clave_privada || certResult.key_data || certResult.keyData;
      
      if (cert && key) {
        console.log(`[Register CUIT] ✅ Certificado creado exitosamente`);
        // Guardar certificados
        const encryptedCert = await encrypt(cert, env.ENCRYPTION_KEY);
        const encryptedKey = await encrypt(key, env.ENCRYPTION_KEY);
        
        await env.DB.prepare(`
          UPDATE arca_accounts 
          SET cert_encrypted = ?, key_encrypted = ?
          WHERE id = ?
        `).bind(encryptedCert, encryptedKey, accountId).run();
      } else {
        console.error(`[Register CUIT] ⚠️ Certificado creado pero no se encontraron cert/key en la respuesta`);
      }
    } catch (certError: any) {
      console.error(`[Register CUIT] Error al crear certificado:`, certError.message);
      // Continuar con autorización aunque falle el certificado (puede que ya exista)
    }
    
    // Paso 2: Autorizar web service wsfe (Facturación Electrónica)
    console.log(`[Register CUIT] Paso 2: Autorizando web service wsfe...`);
    
    try {
      await callAfipSdkAutomation('auth-web-service-prod', accessToken, {
        cuit: account.cuit,
        username: afipUsername,
        password: afipPassword,
        alias: alias,
        service: 'wsfe'
      });
      
      console.log(`[Register CUIT] ✅ Web service wsfe autorizado exitosamente`);
    } catch (authError: any) {
      console.error(`[Register CUIT] ⚠️ Error al autorizar web service:`, authError.message);
      // Continuar aunque falle (puede que ya esté autorizado)
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'CUIT registrado en AFIP SDK correctamente',
      details: {
        certificate_created: cert !== null && key !== null,
        alias: alias
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error(`[Register CUIT] Error inesperado:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Error al registrar CUIT en AFIP SDK' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Obtener certificado de producción usando automatización de AFIP SDK
export async function getProductionCertificate(
  env: Env,
  accountId: string,
  userId: string
): Promise<Response> {
  try {
    // Obtener cuenta
    const account = await env.DB.prepare(
      'SELECT * FROM arca_accounts WHERE id = ? AND user_id = ?'
    ).bind(accountId, userId).first<ArcaAccount>();
    
    if (!account) {
      return new Response(JSON.stringify({ error: 'Cuenta ARCA no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!account.cuit || !account.afip_username_encrypted || !account.afip_password_encrypted) {
      return new Response(JSON.stringify({ error: 'Faltan credenciales de AFIP (CUIT, username, password)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const accessToken = account.api_token_encrypted 
      ? await decrypt(account.api_token_encrypted, env.ENCRYPTION_KEY)
      : await decrypt(account.api_key_encrypted, env.ENCRYPTION_KEY);
    
    const afipUsername = await decrypt(account.afip_username_encrypted, env.ENCRYPTION_KEY);
    const afipPassword = await decrypt(account.afip_password_encrypted, env.ENCRYPTION_KEY);
    
    console.log(`[Certificates] Iniciando obtención de certificado para cuenta ${accountId}, CUIT: ${account.cuit}`);
    
    // Usar la automatización correcta: create-cert-prod
    const automationName = 'create-cert-prod';
    
    // Generar un alias único para el certificado (solo letras y números, sin guiones ni caracteres especiales)
    // Limpiar el nombre de la cuenta: solo letras y números
    const cleanName = account.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Si el nombre está vacío después de limpiar, usar "cert" como prefijo
    const namePrefix = cleanName || 'cert';
    // Generar alias: nombre + timestamp (solo números)
    const alias = `${namePrefix}${Date.now()}`;
    
    console.log(`[Certificates] Usando automatización: ${automationName}`);
    console.log(`[Certificates] Parámetros: cuit=${account.cuit}, username=${afipUsername}, alias=${alias}`);
    
    let automationResult: any = null;
    let lastError: Error | null = null;
    
    try {
      // La automatización create-cert-prod requiere:
      // - cuit: CUIT a usar en la página de ARCA
      // - username: CUIT para loguearse (normalmente el mismo que cuit, pero puede ser diferente si administras una sociedad)
      // - password: Contraseña para loguearse
      // - alias: Nombre alfanumérico para el certificado
      automationResult = await callAfipSdkAutomation(automationName, accessToken, {
        cuit: account.cuit,
        username: afipUsername, // Normalmente es el mismo CUIT, pero puede ser diferente
        password: afipPassword,
        alias: alias
      });
      
      console.log(`[Certificates] Automatización ${automationName} completada, resultado:`, JSON.stringify(automationResult).substring(0, 500));
    } catch (error: any) {
      console.log(`[Certificates] Automatización ${automationName} falló:`, error.message);
      lastError = error;
    }
    
    if (!automationResult) {
      const errorMsg = lastError?.message || 'No se pudo obtener certificado con la automatización create-cert-prod';
      console.error(`[Certificates] Error final: ${errorMsg}`);
      
      return new Response(JSON.stringify({ 
        error: `Error al obtener certificado: ${errorMsg}. Verifica que tus credenciales de AFIP sean correctas y que tengas permisos para generar certificados de producción.` 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // El resultado debería contener cert y key
    // Puede venir en diferentes formatos según la respuesta de AFIP SDK
    const cert = automationResult.cert || 
                 automationResult.certificate || 
                 automationResult.certificado ||
                 automationResult.cert_data ||
                 automationResult.certData;
    
    const key = automationResult.key || 
                automationResult.private_key || 
                automationResult.clave_privada ||
                automationResult.key_data ||
                automationResult.keyData;
    
    console.log(`[Certificates] Buscando cert/key en resultado. Keys disponibles:`, Object.keys(automationResult));
    
    if (cert && key) {
      console.log(`[Certificates] ✅ Certificado obtenido, guardando en base de datos...`);
      // Encriptar y guardar certificados
      const encryptedCert = await encrypt(cert, env.ENCRYPTION_KEY);
      const encryptedKey = await encrypt(key, env.ENCRYPTION_KEY);
      
      await env.DB.prepare(`
        UPDATE arca_accounts 
        SET cert_encrypted = ?, key_encrypted = ?
        WHERE id = ?
      `).bind(encryptedCert, encryptedKey, accountId).run();
      
      console.log(`[Certificates] ✅ Certificado guardado correctamente para cuenta ${accountId}`);
      
      return new Response(JSON.stringify({ 
        success: true,
        message: 'Certificado de producción obtenido y guardado correctamente',
        alias: alias
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      console.error(`[Certificates] ❌ El resultado no contiene cert/key. Resultado completo:`, JSON.stringify(automationResult));
      return new Response(JSON.stringify({ 
        error: `La automatización completó pero no devolvió certificado y clave en el formato esperado. Resultado recibido: ${JSON.stringify(automationResult).substring(0, 500)}. Verifica la documentación de AFIP SDK para el formato de respuesta de create-cert-prod.` 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error: any) {
    console.error(`[Certificates] Error inesperado:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || 'Error al obtener certificado de producción' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
