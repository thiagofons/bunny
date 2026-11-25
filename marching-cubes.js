import { triTable } from './marching-cubes-table.js';

/*
 * Marching Cubes (extensao 3D do marching-squares do curso).
 *
 * Cantos da celula (bit i do caso = 1 quando field < 0, i.e. canto interno):
 *   0:(0,0,0) 1:(1,0,0) 2:(1,0,1) 3:(0,0,1)   (anel inferior, y = 0)
 *   4:(0,1,0) 5:(1,1,0) 6:(1,1,1) 7:(0,1,1)   (anel superior, y = 1)
 * Arestas: 0-3 anel inferior, 4-7 anel superior, 8-11 verticais.
 */
const CORNERS = [
    [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];
const EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Extrai a superficie field(x, y, z) = 0 (interior: field < 0).
 * resolution: numero de celulas por eixo, inteiro ou [nx, ny, nz].
 * normalAt(x, y, z): normal unitaria (para iluminacao) em um ponto da superficie.
 * Retorna vertices nao indexados: positions e normals (vec4 por vertice).
 */
export function marchingCubes(field, normalAt, bounds, resolution) {
    const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
    const [nx, ny, nz] = Array.isArray(resolution) ? resolution : [resolution, resolution, resolution];
    const dx = (maxX - minX) / nx;
    const dy = (maxY - minY) / ny;
    const dz = (maxZ - minZ) / nz;

    // Amostra o campo uma unica vez em cada vertice da grade.
    const sx = nx + 1;
    const sy = ny + 1;
    const samples = new Float64Array(sx * sy * (nz + 1));
    for (let k = 0; k <= nz; k++) {
        for (let j = 0; j <= ny; j++) {
            for (let i = 0; i <= nx; i++) {
                samples[i + sx * (j + sy * k)] = field(minX + i * dx, minY + j * dy, minZ + k * dz);
            }
        }
    }

    const positions = [];
    const normals = [];
    const values = new Array(8);
    const points = new Array(8);
    const edgePoints = new Array(12);

    for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                // Determina o caso da celula.
                let caseIndex = 0;
                for (let c = 0; c < 8; c++) {
                    const [ox, oy, oz] = CORNERS[c];
                    values[c] = samples[(i + ox) + sx * ((j + oy) + sy * (k + oz))];
                    if (values[c] < 0) {
                        caseIndex |= 1 << c;
                    }
                }
                const triangles = triTable[caseIndex];
                if (triangles.length === 0) {
                    continue;
                }

                for (let c = 0; c < 8; c++) {
                    const [ox, oy, oz] = CORNERS[c];
                    points[c] = [minX + (i + ox) * dx, minY + (j + oy) * dy, minZ + (k + oz) * dz];
                }

                // Interseccoes por interpolacao linear nas arestas necessarias.
                edgePoints.fill(null);
                for (const edge of triangles) {
                    if (edgePoints[edge] !== null) {
                        continue;
                    }
                    const [a, b] = EDGES[edge];
                    const t = values[a] / (values[a] - values[b]);
                    edgePoints[edge] = [
                        points[a][0] + t * (points[b][0] - points[a][0]),
                        points[a][1] + t * (points[b][1] - points[a][1]),
                        points[a][2] + t * (points[b][2] - points[a][2]),
                    ];
                }

                for (let t = 0; t < triangles.length; t += 3) {
                    const tri = [
                        edgePoints[triangles[t]],
                        edgePoints[triangles[t + 1]],
                        edgePoints[triangles[t + 2]],
                    ];
                    const n = tri.map((p) => normalAt(p[0], p[1], p[2]));

                    // Orienta o triangulo para que a normal geometrica aponte para fora
                    // (mesmo sentido do gradiente de field).
                    const u = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]];
                    const w = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
                    const g = [
                        u[1] * w[2] - u[2] * w[1],
                        u[2] * w[0] - u[0] * w[2],
                        u[0] * w[1] - u[1] * w[0],
                    ];
                    if (g[0] === 0 && g[1] === 0 && g[2] === 0) {
                        continue; // triangulo degenerado
                    }
                    const avg = [
                        n[0][0] + n[1][0] + n[2][0],
                        n[0][1] + n[1][1] + n[2][1],
                        n[0][2] + n[1][2] + n[2][2],
                    ];
                    if (g[0] * avg[0] + g[1] * avg[1] + g[2] * avg[2] < 0) {
                        [tri[1], tri[2]] = [tri[2], tri[1]];
                        [n[1], n[2]] = [n[2], n[1]];
                    }

                    for (let v = 0; v < 3; v++) {
                        positions.push(tri[v][0], tri[v][1], tri[v][2], 1);
                        normals.push(n[v][0], n[v][1], n[v][2], 0);
                    }
                }
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        vertexCount: positions.length / 4,
    };
}
