// 使用一个全局对象来缓存连接 (简单实现连接复用)
const connectionCache = new Map();

async function fetchWithTimeout(url, options, timeout = 5000) { // 默认超时 5 秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out'); // 抛出超时错误
        }
        throw error; // 抛出其他错误
    }
}

async function getFastestDohServer(dohServers) {
    const timePromises = dohServers.map(async (server) => {
        const startTime = Date.now();
        try {
          const url = new URL(server);
          url.searchParams.set("name", "example.com");
          url.searchParams.set("type", "A");
            const response = await fetchWithTimeout(url.toString(), {
                method: 'GET',
                headers: { 'Accept': 'application/dns-json' },
            }, 3000); // 健康检查超时设为 3 秒

            if (!response.ok) {
              return { server, time: Infinity };
            }
            const endTime = Date.now();
            return { server, time: endTime - startTime };
        } catch (error) {
            //console.error(`Error testing ${server}:`, error);
            return { server, time: Infinity }; // 将失败的服务器的时间设为无穷大
        }
    });

    const results = await Promise.all(timePromises);
    // 找到时间最短且有效的服务器
    let fastest = { time: Infinity, server: null };
    for (const result of results) {
      if (result.time < fastest.time) {
        fastest = result;
      }
    }
    return fastest.server;
}

export async function onRequest(context) {
    try {
        const { request, env } = context;
        const dohServers = env.DOH_SERVERS.split(',');

        // 快速失败机制：如果最近有太多错误，直接返回 503
        // (这里只是一个非常简单的示例，实际应用中可以使用更复杂的机制)
        // if (recentErrors.length > 5) {
        //     return new Response("Service temporarily unavailable", { status: 503 });
        // }


        const fastestServer = await getFastestDohServer(dohServers);
        if (!fastestServer) {
            return new Response("No available DoH servers", { status: 503 });
        }

        const url = new URL(request.url);
        const targetUrl = fastestServer + url.pathname + url.search;

        const headers = new Headers();
        headers.set('Accept', 'application/dns-json');

        // 处理 POST 请求的 Content-Type
        if (request.method === 'POST' && request.headers.get('content-type')) {
            headers.set('Content-Type', request.headers.get('content-type'));
        }

        const dohRequest = new Request(targetUrl, {
            method: request.method,
            headers: headers,
            body: request.body, // 转发请求体
        });

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*', // 允许所有头部，包括 Content-Type
            'Access-Control-Max-Age': '86400',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // const response = await fetch(dohRequest); // 使用原始 fetch
        const response = await fetchWithTimeout(dohRequest, {}, 5000); // 使用带超时的 fetch


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
        // recentErrors.push(Date.now()); // 记录错误发生的时间 (用于快速失败)

        console.error("Error in onRequest:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
}
