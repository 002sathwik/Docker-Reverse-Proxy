import { stat } from "fs";

const http = require('http');
const express = require('express');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });


const db = new Map();



docker.getEvents(function (err: any, stream: any) {
    if (err) {
        console.log(`Error in getting events ${err}`);
    }


    stream.on('data', async (chunk: any) => {
        if (!chunk) {
            return
        }
        const event = JSON.parse(chunk.toString());

        if (event.Type === 'container' && event.Action === 'start') {
            const container = docker.getContainer(event.id);

            const containerInfo = await container.inspect();

            const containerName = containerInfo.Name.substring(1);
            const containerIP = containerInfo.NetworkSettings.IPAddress;
            const exposedPort = Object.keys(containerInfo.Config.ExposedPorts);
            let defaultPort = null;
            if (exposedPort && exposedPort.length > 0) {
                const [port, type] = exposedPort[0].split('/');
                if (type == "tcp") {
                    defaultPort = port
                    console.log(`Container ${containerName} is running on ${containerIP}:${port}`);
                }
            }

            console.log(` Registering container ${containerName}.localhost ---> http://${containerIP}:${defaultPort}`);
            db.set(containerName, {
                containerName,
                containerIP,
                defaultPort
            })
        }
    })
})















const managementAPI = express();
managementAPI.use(express.json());


managementAPI.post('/containers', async (req: any, res: any) => {
    const { image, tag = "latest" } = req.body;
    const images = await docker.listImage()
    let imageAlreadyExists = false;

    for (const systemImages of images) {
        for (const systemTag of systemImages.RepoTags) {
            if (systemImages === `${image}:${tag}`) {
                imageAlreadyExists = true;
                break;
            }
        }
        if (imageAlreadyExists) break;
    }

    if (!imageAlreadyExists) {
        console.log(`Pulling image ${image}:${tag}`);
        await docker.pull(`${image}:${tag}`);
    }

    const container = await docker.createContainer({
        Image: `${image}:${tag}`,
        Tty: false,
        HostConfig: {
            AutoRemove: true,
        },
    });
    await container.start()

    return res.json({
        status: 'success',
        message: 'Container created successfully',
        container: `${(await container.inspect()).Name}.localhost`
    })
});


managementAPI.listen(8080, () => {
    console.log('Management API is running on port 3000');
});