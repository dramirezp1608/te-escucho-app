import { dataverseRequest } from './dataverse.js';

// Convierte un string base64url a Uint8Array
function base64urlUnescape(str) {
    str += new Array(5 - str.length % 4).join('=');
    return str.replace(/\-/g, '+').replace(/_/g, '/');
}

function base64urlEscape(str) {
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Genera un JWT HMAC SHA-256
export async function generateJWT(secret, email) {
    if (!secret) throw new Error("JWT_SECRET is missing");
    
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { 
        sub: email, 
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // 24 horas
    };
    
    const enc = new TextEncoder();
    const encodedHeader = base64urlEscape(btoa(JSON.stringify(header)));
    const encodedPayload = base64urlEscape(btoa(JSON.stringify(payload)));
    
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(dataToSign));
    const encodedSignature = base64urlEscape(btoa(String.fromCharCode(...new Uint8Array(signature))));
    
    return `${dataToSign}.${encodedSignature}`;
}

// Verifica el JWT
export async function verifyJWT(secret, token) {
    if (!secret) throw new Error("JWT_SECRET is missing");
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error("Token JWT malformado");
    
    const [header, payload, signature] = parts;
    const dataToSign = `${header}.${payload}`;
    
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    
    const sigBytes = new Uint8Array(atob(base64urlUnescape(signature)).split('').map(c => c.charCodeAt(0)));
    
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(dataToSign));
    if (!isValid) throw new Error("Firma JWT inválida");
    
    const decodedPayload = JSON.parse(atob(base64urlUnescape(payload)));
    if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("El token JWT ha expirado");
    }
    
    return decodedPayload.sub;
}

export async function verifyAdmin(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Falta el encabezado Authorization");
    }
    
    const token = authHeader.split(' ')[1];
    
    // 1. Validar el JWT local
    const email = await verifyJWT(env.JWT_SECRET, token);
    
    // 2. Buscar si el correo sigue siendo válido en Dataverse
    const query = `coem_administradors?$filter=coem_correo eq '${email}'`;
    const result = await dataverseRequest(env, query);
    
    if (!result || !result.value || result.value.length === 0) {
        throw new Error(`Acceso denegado: El correo ${email} no es administrador.`);
    }
    
    return { email, adminData: result.value[0] };
}
