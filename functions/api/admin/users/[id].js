import { verifyAdmin } from '../../../../../utils/auth.js';
import { dataverseRequest } from '../../../../../utils/dataverse.js';

export async function onRequestPatch(context) {
    try {
        await verifyAdmin(context.request, context.env);
        const id = context.params.id;
        const body = await context.request.json();
        const result = await dataverseRequest(context.env, `coem_administradors(${id})`, 'PATCH', body);
        return Response.json(result);
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function onRequestDelete(context) {
    try {
        await verifyAdmin(context.request, context.env);
        const id = context.params.id;
        await dataverseRequest(context.env, `coem_administradors(${id})`, 'DELETE');
        return Response.json({ success: true });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}
