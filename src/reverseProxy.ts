import http from 'http';
const express = require('express');
import httpProxy from 'http-proxy';
import { db } from './dockerEvents';

const proxy = httpProxy.createProxy({});
const reverseProxyApp = express();

reverseProxyApp.use((req: any, res: any) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];

    if (!db.has(subdomain)) {
        return res.status(404).json({
            status: 'error',
            message: 'Container not found'
        });
    }

    const { containerIP, defaultPort } = db.get(subdomain)!;
    const target = `http://${containerIP}:${defaultPort}`;

    console.log(`Forwarding ${hostname} request to ---> ${target}`);

    return proxy.web(req, res, { target, changeOrigin: true, ws: true }, (err: any) => {
        if (err) {
            console.error(`Error forwarding request: ${err.message}`);
            res.status(500).send('Proxy error');
        }
    });
});

const reverseProxy = http.createServer(reverseProxyApp);

reverseProxy.on('upgrade', (req: http.IncomingMessage, socket: any, head: any) => {
    const hostname = req.headers.host!.split(':')[0];
    const subdomain = hostname.split('.')[0];

    if (!db.has(subdomain)) {
        return socket.destroy();
    }

    const { containerIP, defaultPort } = db.get(subdomain)!;
    const target = `http://${containerIP}:${defaultPort}`;

    console.log(`Forwarding ${hostname} request to ---> ${target}`);

    return proxy.ws(req, socket, head, { target: target, ws: true }, (err: any) => {
        if (err) {
            console.error(`Error forwarding websocket: ${err.message}`);
            socket.destroy();
        }
    });
});

export const startReverseProxy = () => {
    reverseProxy.listen(80, () => {
        console.log('Reverse proxy is running on port 80');
    });
};
