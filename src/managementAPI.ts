const express = require('express');
const Docker = require('dockerode');

const docker = new Docker();
const managementAPI = express();
managementAPI.use(express.json());

managementAPI.post('/containers', async (req: any, res: any) => {
    const { image, tag = "latest" } = req.body;

    const images = await docker.listImages();

    let imageAlreadyExists = false;

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
        await new Promise<void>((resolve, reject) => {
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

export const startManagementAPI = () => {
    managementAPI.listen(8080, () => {
        console.log('Management API is running on port 8080');
    });
};
