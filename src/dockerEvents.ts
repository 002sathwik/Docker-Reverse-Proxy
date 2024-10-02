import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
export const db = new Map<string, { containerName: string; containerIP: string; defaultPort: string }>();

docker.getEvents((err: any, stream: any) => {
    if (err) {
        console.log(`Error in getting events ${err}`);
        return;
    }

    try {
        stream.on('data', async (chunk: any) => {
            if (!chunk) {
                return;
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
                let defaultPort: string | null = null;

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
