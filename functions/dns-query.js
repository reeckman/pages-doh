async function measureResponseTime(url) {
    const start = Date.now();
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/dns-json' // 明确指定接受 JSON 格式
            }
        });

        if (!response.ok) {
            //console.error(`Error fetching from ${url}: ${response.status}`);
            return Infinity; // 如果请求失败，返回一个非常大的时间
        }
        const end = Date.now();
        return end - start;

    } catch (error) {
        //console.error(`Error measuring response time for ${url}:`, error);
        return Infinity; // 捕获任何错误，也返回一个非常大的时间
    }

}

async function getFastestDohServer(dohServers) {
    // 并发测量所有 DoH 服务器的响应时间
    const timePromises = dohServers.map(server => measureResponseTime(server + "?name=example.com&type=A")); //添加一个简单的查询
    const responseTimes = await Promise.all(timePromises);

    // 找出最快的服务器
    let fastestTime = Infinity;
    let fastestServer = null;
    for (let i = 0; i < responseTimes.length; i++) {
        if (responseTimes[i] < fastestTime) {
            fastestTime = responseTimes[i];
            fastestServer = dohServers[i];
        }
    }
    //console.log(`Fastest DoH server: ${fastestServer} (${fastestTime}ms)`);
    return fastestServer;
}

export async function onRequest(context) {
    try {
        const { request, env } = context;

        // 1. 获取 DoH 服务器列表（从环境变量中）
        const dohServers = env.DOH_SERVERS.split(',');

        // 2. 选择最快的 DoH 服务器
        const fastestServer = await getFastestDohServer(dohServers);

        if (!fastestServer) {
            return new Response("No available DoH servers", { status: 503 });
        }

        // 3. 构建新的请求 URL
        const url = new URL(request.url);
        const targetUrl = fastestServer + url.pathname + url.search; //保持查询路径和参数

        // 4.  转发请求 (使用 fetch API)
        const dohRequest = new Request(targetUrl, {
            method: request.method,
            headers: request.headers, // 直接转发所有头部
            body: request.body, // 转发请求体（如果有的话）
        });
        
        // 5. 设置CORS头以允许跨域请求
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*', // 允许所有来源
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // 允许的请求方法
          'Access-Control-Allow-Headers': '*', // 允许所有请求头
          'Access-Control-Max-Age': '86400', // 预检请求的缓存时间（秒）
        };
        
        if (request.method === 'OPTIONS') {
            // 处理预检请求（Preflight Request）
              return new Response(null, {
              headers: corsHeaders,
              });
        }


        const response = await fetch(dohRequest);

        // 6. 返回响应（包括 DoH 服务器的响应头）
        const newHeaders = new Headers(response.headers);  //复制所有响应头
        for (const key in corsHeaders) {
                newHeaders.set(key, corsHeaders[key]); // 添加 CORS 头部
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
