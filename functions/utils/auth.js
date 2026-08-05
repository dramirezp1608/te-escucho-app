import { dataverseRequest } from './dataverse.js';

export async function verifyAdmin(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error("Missing or invalid Authorization header");
    }
    
    const token = authHeader.split(' ')[1];
    
    // 1. Validar el token contra Microsoft Graph
    // Si Graph lo acepta, significa que el token fue emitido por Entra ID,
    // pertenece a un usuario real, no ha expirado y la firma es válida.
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!graphResponse.ok) {
        throw new Error("Invalid Entra ID token. Could not authenticate with Microsoft Graph.");
    }
    
    const profile = await graphResponse.json();
    const email = profile.mail || profile.userPrincipalName;
    
    if (!email) {
        throw new Error("Could not determine user email from Microsoft Graph.");
    }
    
    // 2. Buscar si el correo existe en la tabla de administradores de Dataverse
    // Asegurarse de que el logical name de la tabla y la columna sea correcto.
    const query = `coem_administradors?$filter=coem_correo eq '${email}'`;
    const result = await dataverseRequest(env, query);
    
    if (!result || !result.value || result.value.length === 0) {
        throw new Error(`Acceso denegado: El correo ${email} no es administrador.`);
    }
    
    return { email, adminData: result.value[0] };
}
