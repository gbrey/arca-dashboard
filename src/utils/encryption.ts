// Encriptación simple usando Web Crypto API
// Para producción, considerar usar algoritmos más robustos

export async function encrypt(plaintext: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // Derivar clave desde el string
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    data
  );
  
  // Combinar IV + datos encriptados y convertir a base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertext: string, key: string): Promise<string> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  
  // Decodificar base64
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  
  // Extraer IV (primeros 12 bytes)
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);
  
  // Derivar clave
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    keyMaterial,
    encrypted
  );
  
  return decoder.decode(decrypted);
}

