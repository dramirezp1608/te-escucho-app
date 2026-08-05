import { verifyAdmin } from '../../../../utils/auth.js';
import { dataverseRequest } from '../../../../utils/dataverse.js';

export async function onRequestGet(context) {
    try {
        await verifyAdmin(context.request, context.env);
        const result = await dataverseRequest(context.env, 'coem_parametroglobalideacions');
        return Response.json(result.value);
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function onRequestPost(context) {
    try {
        await verifyAdmin(context.request, context.env);
        const body = await context.request.json();
        const result = await dataverseRequest(context.env, 'coem_parametroglobalideacions', 'POST', body);
        return Response.json(result);
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
}
