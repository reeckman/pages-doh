async function measureResponseTime(url) {
    const start = Date.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/dns-json'
            }
        });

        if (!response.ok) {
            return Infinity;
        }
        const end = Date.now();
        return end - start;

    } catch (error) {
        return Infinity;
    }
}

async function getFastestDohServer(dohServers) {
    const timePromises = dohServers.map(server => measureResponseTime(server + "?name=example.com&type=A"));
    const responseTimes = await Promise.all(timePromises);

    let fastestTime = Infinity;
    let fastestServer = null;
    for (let i = 0; i < responseTimes.length; i++) {
        if (responseTimes[i] < fastestTime) {
            fastestTime = responseTimes[i];
            fastestServer = dohServers[i];
        }
    }
    return fastestServer;
}

export async function onRequest(context) {
    try {
        const { request, env } = context;
        const dohServers = env.DOH_SERVERS.split(',');
        const fastestServer = await getFastestDohServer(dohServers);

        if (!fastestServer) {
            return new Response("No available DoH servers", { status: 503 });
        }

        const url = new URL(request.url);
        const targetUrl = fastestServer + url.pathname + url.search;

        // 构建新的请求头
        const headers = new Headers();
        headers.set('Accept', 'application/dns-json'); // 明确指定 DoH JSON 格式

        // 复制必要的请求头 (例如, content-type 如果是 POST 请求)
        if (request.headers.get('content-type')) {
          headers.set('content-type', request.headers.get('content-type'));
        }

        // 不需要设置 Host 头部，fetch 会自动处理

        const dohRequest = new Request(targetUrl, {
            method: request.method,
            headers: headers,  // 使用我们构建的头部
            body: request.body,
        });

        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        };

        if (request.method === 'OPTIONS') {
              return new Response(null, {
              headers: corsHeaders,
              });
        }

        const response = await fetch(dohRequest);
        const newHeaders = new Headers(response.headers);
        for (const key in corsHeaders) {
                newHeaders.set(key, corsHeaders[key]);
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });

    } catch (error) {
        console.error("Error in onRequest:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}
