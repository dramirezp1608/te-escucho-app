import { dataverseRequest } from '../../../utils/dataverse.js';
import { generateJWT } from '../../../utils/auth.js';

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const email = body.email;
        const password = body.password;

        if (!email || !password) {
            return new Response(JSON.stringify({ error: "Credenciales inválidas" }), { status: 400 });
        }

        // 1. Buscar el administrador en Dataverse
        const query = `coem_administradors?$filter=coem_correo eq '${email}'`;
        const result = await dataverseRequest(context.env, query);

        if (!result || !result.value || result.value.length === 0) {
            return new Response(JSON.stringify({ error: "Acceso denegado: Usuario no encontrado" }), { status: 401 });
        }

        const admin = result.value[0];

        // 2. Verificar la contraseña (texto plano en Dataverse según lo acordado)
        if (admin.coem_password !== password) {
            return new Response(JSON.stringify({ error: "Acceso denegado: Contraseña incorrecta" }), { status: 401 });
        }

        // 3. Generar JWT firmado por Cloudflare
        const token = await generateJWT(context.env.JWT_SECRET, email);

        return Response.json({
            success: true,
            token: token,
            email: email
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: "Error en el servidor", details: e.message }), { status: 500 });
    }
}
