export async function getAccessToken(env) {
    const tokenUrl = `https://login.microsoftonline.com/${env.DATAVERSE_TENANT_ID}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams();
    params.append('client_id', env.DATAVERSE_CLIENT_ID);
    params.append('client_secret', env.DATAVERSE_CLIENT_SECRET);
    params.append('scope', `${env.DATAVERSE_ENVIRONMENT_URL}/.default`);
    params.append('grant_type', 'client_credentials');

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Error getting Dataverse token: ${error}`);
    }

    const data = await response.json();
    return data.access_token;
}

export async function dataverseRequest(env, endpoint, method = 'GET', body = null) {
    const token = await getAccessToken(env);
    // Asegurar que no haya dobles slashes en la URL
    const baseUrl = env.DATAVERSE_ENVIRONMENT_URL.replace(/\/$/, "");
    const url = `${baseUrl}/api/data/v9.2/${endpoint}`;
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
    };
    
    if (method === 'POST' || method === 'PATCH') {
        headers['Prefer'] = 'return=representation';
    }

    const options = {
        method,
        headers
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 204) {
        return null;
    }

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Dataverse Error (${response.status}): ${error}`);
    }

    return await response.json();
}
