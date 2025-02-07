async function dohQuery(server, request) {
    const url = new URL(request.url);
    const targetUrl = server + url.pathname + url.search;

    const headers = new Headers();
    headers.set('Accept', 'application/dns-json');

    // 处理 POST 请求的 Content-Type
    if (request.method === 'POST' && request.headers.get('content-type')) {
        headers.set('Content-Type', request.headers.get('content-type'));
    }

    const dohRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method === 'POST' ? request.body : undefined, // 只在 POST 请求中包含 body
    });

    try {
        const response = await fetch(dohRequest, {
            // Cloudflare Workers 默认有超时，但这里显式设置以提高可读性
            cf: {
                resolveOverride: new URL(server).hostname, // 强制解析到 DoH 服务器的 IP, 绕过可能的 DNS 问题
            }
        });
        return response;

    } catch (error) {
        console.error(`DoH query to ${server} failed:`, error);
        return null; // 查询失败返回 null
    }
}

export async function onRequest(context) {
    const { request, env } = context;
    const dohServers = env.DOH_SERVERS.split(',');

    // CORS 设置 (提前处理 OPTIONS 请求)
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept', // 明确允许的头部
        'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // 并发查询所有 DoH 服务器,并过滤
    const responses = (await Promise.all(dohServers.map(server => dohQuery(server, request)))).filter(r => r !== null && r.ok);

    if (responses.length === 0) {
        return new Response("All DoH servers failed", { status: 502 }); // Bad Gateway
    }

    // 选择第一个成功的响应 (不一定是“最快”，而是第一个返回成功的)
    const response = responses[0];

    const newHeaders = new Headers(response.headers);
    for (const key in corsHeaders) {
        newHeaders.set(key, corsHeaders[key]);
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}
