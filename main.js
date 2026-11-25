import vertShaderSrc from './scene.vert.js';
import fragShaderSrc from './scene.frag.js';
import WebGPU from './lib/webgpu.js';
import {
    createLookAtMat4,
    createNormalMat4,
    createPerspectiveMat4,
    createScaleMat4,
    createTranslationMat4,
    createIdentityMat4,
    multiplyMat4,
} from './lib/utils.js';
import { HalfEdgeDS } from './half-edge.js';
import { loadPly } from './load-ply.js';
import { buildTableMesh, TABLE_RESOLUTION, TABLE_HEIGHT } from './implicit-table.js';

const WIDTH = 1024;
const HEIGHT = 768;

// Layout do uniform (em floats) - deve coincidir com scene.vert/frag.js.
const UNIFORM_FLOATS = 108;
const OFFSET = { model: 0, view: 16, projection: 32, normal: 48, ambient: 64, lights: 68, material: 92 };

/**
 * Cria a textura do chao com cadeia de mipmaps (reduz aliasing das telhas ao longe).
 */
async function createMipmappedTexture(gpu, url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Nao foi possivel carregar a textura: HTTP ${response.status}.`);
    }
    const blob = await response.blob();
    const base = await createImageBitmap(blob);
    const levels = Math.floor(Math.log2(Math.max(base.width, base.height))) + 1;

    const texture = gpu.device.createTexture({
        size: [base.width, base.height, 1],
        format: 'rgba8unorm',
        mipLevelCount: levels,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    for (let level = 0; level < levels; level++) {
        const width = Math.max(1, base.width >> level);
        const height = Math.max(1, base.height >> level);
        const source = level === 0
            ? base
            : await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
        gpu.device.queue.copyExternalImageToTexture({ source }, { texture, mipLevel: level }, [width, height]);
    }

    return texture;
}

class SceneObject {
    constructor(gpu, program, sampler, texture, geometry, modelMatrix, material) {
        this.program = program;
        this.modelMatrix = modelMatrix;
        this.material = material;

        this.shape = gpu.createShape({
            buffers: [geometry.positions, geometry.normals, geometry.uvs],
            indices: geometry.indices,
            vertexCount: geometry.vertexCount,
        });

        this.data = new Float32Array(UNIFORM_FLOATS);
        this.buffer = gpu.createUniformBuffer(this.data);
        this.bindGroup = gpu.createBindGroup(program, [
            { binding: 0, resource: { buffer: this.buffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: texture.createView() },
        ]);

        const { ka, kd, ks, shininess, useTexture } = material;
        this.data.set([...ka, 0], OFFSET.material);
        this.data.set([...kd, 0], OFFSET.material + 4);
        this.data.set([...ks, 0], OFFSET.material + 8);
        this.data.set([shininess, useTexture ? 1 : 0, 0, 0], OFFSET.material + 12);
        this.data.set(modelMatrix, OFFSET.model);
    }

    draw(gpu, view, projection, lighting) {
        const normalMatrix = createNormalMat4(multiplyMat4(view, this.modelMatrix));

        this.data.set(view, OFFSET.view);
        this.data.set(projection, OFFSET.projection);
        this.data.set(normalMatrix, OFFSET.normal);
        this.data.set(lighting.ambient, OFFSET.ambient);
        lighting.lights.forEach((light, i) => {
            this.data.set(light.position, OFFSET.lights + 12 * i);
            this.data.set(light.diffuse, OFFSET.lights + 12 * i + 4);
            this.data.set(light.specular, OFFSET.lights + 12 * i + 8);
        });

        gpu.writeBuffer(this.buffer, this.data);
        gpu.draw(this.program, this.shape, [this.bindGroup]);
    }
}

function zeroUvs(vertexCount) {
    return new Float32Array(vertexCount * 2);
}

class Scene {
    constructor(gpu, floorTexture, bunnyHe, tableMesh) {
        // Luzes pontuais fixas no mundo (nao acompanham a camera).
        this.lighting = {
            ambient: [0.22, 0.22, 0.22, 1],
            lights: [
                {
                    position: [-4, 6, 5, 1],
                    diffuse: [0.55, 0.55, 0.5, 1],
                    specular: [0.6, 0.6, 0.55, 1],
                },
                {
                    position: [5, 4.5, -3, 1],
                    diffuse: [0.4, 0.45, 0.55, 1],
                    specular: [0.4, 0.45, 0.55, 1],
                },
            ],
        };

        const program = gpu.createProgram(vertShaderSrc, fragShaderSrc, {
            cullMode: 'none',
            buffers: [
                { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] },
                { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
                { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
            ],
        });

        const sampler = gpu.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            maxAnisotropy: 8,
        });

        this.objects = [];

        // Chao: dois triangulos em y = 0, uv repetindo a textura varias vezes.
        const s = 12;
        const repeat = 8; // repeticoes da textura por lado do chao
        const floor = {
            positions: new Float32Array([
                -s, 0, -s, 1, -s, 0, s, 1, s, 0, s, 1,
                -s, 0, -s, 1, s, 0, s, 1, s, 0, -s, 1,
            ]),
            normals: new Float32Array([
                0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
                0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
            ]),
            uvs: new Float32Array([
                0, 0, 0, repeat, repeat, repeat,
                0, 0, repeat, repeat, repeat, 0,
            ]),
            vertexCount: 6,
        };
        this.objects.push(new SceneObject(gpu, program, sampler, floorTexture, floor, createIdentityMat4(), {
            ka: [1, 1, 1], kd: [1, 1, 1], ks: [0.12, 0.12, 0.12], shininess: 24, useTexture: true,
        }));

        // Mesa (superficie implicita, ja em coordenadas de mundo: base em y = 0).
        const table = {
            positions: tableMesh.positions,
            normals: tableMesh.normals,
            uvs: zeroUvs(tableMesh.vertexCount),
            vertexCount: tableMesh.vertexCount,
        };
        this.objects.push(new SceneObject(gpu, program, sampler, floorTexture, table, createIdentityMat4(), {
            ka: [0.15, 0.35, 0.85], kd: [0.15, 0.35, 0.85], ks: [0.25, 0.25, 0.25], shininess: 40, useTexture: false,
        }));

        // Bunny: centra em x/z, apoia a base em y = 0, escala e sobe ate o topo da mesa.
        const { min, max } = bunnyHe.getBounds();
        const bunnyHeight = 1.1;
        const scale = bunnyHeight / (max[1] - min[1]);
        const center = createTranslationMat4(-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2);
        const resize = createScaleMat4(scale, scale, scale);
        const lift = createTranslationMat4(0, TABLE_HEIGHT, 0);
        const bunnyModel = multiplyMat4(lift, multiplyMat4(resize, center));

        const { positions, normals, indices } = bunnyHe.getVBOs();
        const bunny = {
            positions, normals, indices,
            uvs: zeroUvs(bunnyHe.vertices.length),
            vertexCount: bunnyHe.vertices.length,
        };
        this.objects.push(new SceneObject(gpu, program, sampler, floorTexture, bunny, bunnyModel, {
            ka: [0.9, 0.87, 0.8], kd: [0.9, 0.87, 0.8], ks: [0.2, 0.2, 0.2], shininess: 30, useTexture: false,
        }));

        // Camera: orbita em torno do centro da cena; a roda controla a distancia.
        this.target = [0, TABLE_HEIGHT + 0.4, 0];
        this.elevation = (20 * Math.PI) / 180;
        this.distance = 8;
        this.minDistance = 3;
        this.maxDistance = 25;
    }

    zoom(delta) {
        this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * Math.exp(delta * 0.001)));
    }

    createViewMatrix() {
        const eye = [
            this.target[0],
            this.target[1] + this.distance * Math.sin(this.elevation),
            this.target[2] + this.distance * Math.cos(this.elevation),
        ];
        return createLookAtMat4(eye, this.target, [0, 1, 0], true);
    }

    draw(gpu) {
        const view = this.createViewMatrix();
        const projection = createPerspectiveMat4(Math.PI / 4, WIDTH / HEIGHT, 0.1, 100);
        for (const object of this.objects) {
            object.draw(gpu, view, projection, this.lighting);
        }
    }
}

class Main {
    async init() {
        this.gpu = await WebGPU.createCanvas('#glcanvas', WIDTH, HEIGHT, {
            clearColor: { r: 0.62, g: 0.75, b: 0.88, a: 1 }, // fundo: cor solida
        });

        const [ply, floorTexture] = await Promise.all([
            loadPly(new URL('./bunny/bunny/reconstruction/bun_zipper.ply', import.meta.url)),
            createMipmappedTexture(this.gpu, new URL('./texture/Tiles074_1K-JPG_Color.jpg', import.meta.url)),
        ]);

        const bunnyHe = new HalfEdgeDS();
        bunnyHe.build(ply.coords, ply.indices);

        const t0 = performance.now();
        const tableMesh = buildTableMesh();
        const tableMs = performance.now() - t0;

        const info = [
            `Bunny: ${bunnyHe.vertices.length} vertices, ${bunnyHe.faces.length} faces, `
            + `${bunnyHe.boundaryHalfEdges} semi-arestas de bordo`,
            `Mesa: grade ${TABLE_RESOLUTION.join('x')} celulas, ${tableMesh.vertexCount / 3} triangulos `
            + `(${tableMs.toFixed(0)} ms)`,
            'Roda do mouse: distancia da camera',
        ].join('\n');
        console.log(info);
        document.querySelector('#info').textContent = info;

        this.scene = new Scene(this.gpu, floorTexture, bunnyHe, tableMesh);

        this.gpu.canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            this.scene.zoom(event.deltaY);
        }, { passive: false });
    }

    draw() {
        this.gpu.start();
        this.scene.draw(this.gpu);
        this.gpu.finish();
        requestAnimationFrame(this.draw.bind(this));
    }
}

try {
    const app = new Main();
    await app.init();
    app.draw();
} catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML('beforeend', `<p>${error.message}</p>`);
}
