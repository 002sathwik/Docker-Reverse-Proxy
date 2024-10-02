const http = require('http');
const express = require('express');
const Docker = require('dockerode');
const httpProxy = require('http-proxy');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const proxy = httpProxy.createProxy({});
const db = new Map();

docker.getEvents(function (err: any, stream: any) {
    if (err) {
        console.log(`Error in getting events ${err}`);
    }

    try {
        stream.on('data', async (chunk: any) => {
            if (!chunk) {
                return
            }
            const event = JSON.parse(chunk.toString());

            if (event.Type === 'container' && event.Action === 'start') {
                const container = docker.getContainer(event.id);


                const containerInfo = await container.inspect().catch((error: any) => {
                    console.error(`Failed to inspect container ${event.id}: ${error.message}`);
                    return null;
                });

                if (!containerInfo) return;

                const containerName = containerInfo.Name.substring(1);
                const containerIP = containerInfo.NetworkSettings.IPAddress;


                if (!containerIP) {
                    console.error(`No IP found for container ${containerName}`);
                    return;
                }


                const exposedPort = containerInfo.Config.ExposedPorts ? Object.keys(containerInfo.Config.ExposedPorts) : [];
                let defaultPort = null;

                if (exposedPort.length > 0) {
                    const [port, type] = exposedPort[0].split('/');


                    if (!port || !type) {
                        console.error(`Malformed exposed port for container ${containerName}`);
                        return;
                    }

                    if (type === "tcp") {
                        defaultPort = port;
                        console.log(`Container ${containerName} is running on ${containerIP}:${port}`);
                    }
                }

                if (!defaultPort) {
                    console.error(`No valid TCP port exposed for container ${containerName}`);
                    return;
                }

                console.log(`Registering container ${containerName}.localhost ---> http://${containerIP}:${defaultPort}`);
                db.set(containerName, {
                    containerName,
                    containerIP,
                    defaultPort
                });
            }
        });
    } catch (error) {
        console.log(`Error in getting events ${error}`);
    }
});

const reverseProxyApp = express();

reverseProxyApp.use(function (req: any, res: any) {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];

    if (!db.has(subdomain)) {
        return res.status(404).json({
            status: 'error',
            message: 'Container not found'
        });
    }

    const { containerIP, defaultPort } = db.get(subdomain);

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

reverseProxy.on('upgrade', function (req: any, socket: any, head: any) {
    const hostname = req.headers.host.split(':')[0];
    const subdomain = hostname.split('.')[0];

    if (!db.has(subdomain)) {
        return socket.destroy();
    }

    const { containerIP, defaultPort } = db.get(subdomain);

    const target = `http://${containerIP}:${defaultPort}`;


    console.log(`Forwarding ${hostname} request to ---> ${target}`);

    return proxy.ws(req, socket, head, { target: target, ws: true }, (err: any) => {
        if (err) {
            console.error(`Error forwarding websocket: ${err.message}`);
            socket.destroy();
        }
    });
});


const managementAPI = express();
managementAPI.use(express.json());

managementAPI.post('/containers', async (req: any, res: any) => {
    const { image, tag = "latest" } = req.body;

    // Error: Incorrect function name, should be docker.listImages()
    const images = await docker.listImages();

    let imageAlreadyExists = false;

    // Error: systemImages.RepoTags can be undefined, add a check
    for (const systemImages of images) {
        if (!systemImages.RepoTags) continue; // skip images without tags
        for (const systemTag of systemImages.RepoTags) {
            if (systemTag === `${image}:${tag}`) {
                imageAlreadyExists = true;
                break;
            }
        }
        if (imageAlreadyExists) break;
    }

    if (!imageAlreadyExists) {
        console.log(`Pulling image ${image}:${tag}`);
        // Error: Add a try-catch to docker.pull()
        await new Promise((resolve, reject) => {
            docker.pull(`${image}:${tag}`, (err: any, stream: any) => {
                if (err) {
                    console.error(`Failed to pull image ${image}:${tag}`);
                    return reject(err);
                }
                stream.pipe(process.stdout);
                stream.on('end', resolve);
            });
        });
    }

    // Error: Add try-catch around container creation and starting
    let container;
    try {
        container = await docker.createContainer({
            Image: `${image}:${tag}`,
            Tty: false,
            HostConfig: {
                AutoRemove: true,
            },
        });
        await container.start();
    } catch (error) {
        console.error(`Failed to create/start container: ${error}`);
        return res.status(500).json({ status: 'error', message: 'Failed to create container' });
    }

    const containerInfo = await container.inspect();

    return res.json({
        status: 'success',
        message: 'Container created successfully',
        container: `${containerInfo.Name.substring(1)}.localhost`
    });
});

managementAPI.listen(8080, () => {
    console.log('Management API is running on port 8080');
});

reverseProxy.listen(80, () => {
    console.log('Reverse proxy is running on port 80');
});
