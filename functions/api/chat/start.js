import { dataverseRequest } from '../../../utils/dataverse.js';

export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const projectId = url.searchParams.get('id');

        if (!projectId) {
            return new Response(JSON.stringify({ error: "No se proporcionó ID de proyecto." }), { status: 403 });
        }

        // 1. Validar el proyecto
        const project = await dataverseRequest(context.env, `coem_proyectoinnovacions(${projectId})`);
        
        if (!project) {
            return new Response(JSON.stringify({ error: "Proyecto no encontrado." }), { status: 403 });
        }

        const now = new Date();
        const startDate = new Date(project.coem_fechainicio);
        const endDate = new Date(project.coem_fechafin);

        if (now < startDate || now > endDate) {
            return new Response(JSON.stringify({ error: "El proyecto no se encuentra en una fecha activa." }), { status: 403 });
        }

        // 2. Obtener parámetros de conexión
        const paramsResult = await dataverseRequest(context.env, 'coem_parametroglobalideacions');
        const paramsList = paramsResult.value || [];
        
        const copilotSecretObj = paramsList.find(p => p.coem_nombre === 'CopilotSecret');
        const copilotUrlObj = paramsList.find(p => p.coem_nombre === 'CopilotUrl');

        if (!copilotSecretObj || !copilotUrlObj) {
            return new Response(JSON.stringify({ error: "Parámetros de Copilot no configurados en el sistema." }), { status: 500 });
        }

        const copilotSecret = copilotSecretObj.coem_valor;
        const copilotUrl = copilotUrlObj.coem_valor;

        // 3. Generar token y conversación
        let chatData;
        
        if (copilotUrl.includes('powerplatform.com') || copilotUrl.includes('powervirtualagents')) {
            // Reemplazar la parte de /conversations por /directline/token manteniendo la estructura exacta de la URL original
            const tokenEndpoint = copilotUrl.replace('/conversations', '/directline/token');
            
            // 1. Obtener Token Anónimo
            const tokenRes = await fetch(tokenEndpoint, { method: 'GET' });
            
            if (!tokenRes.ok) {
                const err = await tokenRes.text();
                throw new Error(`Error al solicitar token anónimo: ${err}`);
            }
            const tokenData = await tokenRes.json();
            const anonymousToken = tokenData.token;
            
            // 2. Iniciar Conversación
            const convUrl = copilotUrl; // Usamos la original que tiene /conversations
            const chatResponse = await fetch(convUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${anonymousToken}`
                }
            });
            
            if (!chatResponse.ok) {
                const err = await chatResponse.text();
                throw new Error(`Copilot Studio Error al iniciar chat (${chatResponse.status}): ${err}`);
            }
            
            chatData = await chatResponse.json();
            chatData.token = chatData.token || anonymousToken;
            
        } else {
            // Es la URL de Bot Framework clásica (Direct Line con Secreto)
            let tokenUrl = copilotUrl;
            if (tokenUrl.endsWith('/conversations')) {
                tokenUrl = tokenUrl.replace('/conversations', '/tokens/generate');
            }
            const chatResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${copilotSecret.trim()}`
                }
            });
            
            if (!chatResponse.ok) {
                const errorText = await chatResponse.text();
                throw new Error(`Copilot Studio Error Clásico (${chatResponse.status}): ${errorText}`);
            }
            chatData = await chatResponse.json();
        }

        // Devolvemos los datos al frontend.
        return new Response(JSON.stringify({
            success: true,
            copilotToken: chatData.token,
            conversationId: chatData.conversationId,
            streamUrl: chatData.streamUrl,
            endpoint: copilotUrl,
            projectName: project.coem_nombrecliente
        }), { 
            headers: { 'Content-Type': 'application/json' } 
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
