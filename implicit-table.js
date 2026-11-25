import { marchingCubes } from './marching-cubes.js';

export const TABLE_HEIGHT = 1.6;
export const TABLE_RESOLUTION = [128, 128, 128];

// Ramos do max: lateral, base (y >= 0) e topo (y <= 1.6).
export function tableField(x, y, z) {
    return Math.max(
        x * x + z * z - 0.36 - 2.5 * (y - 0.8) * (y - 0.8),
        -y,
        y - TABLE_HEIGHT,
    );
}

// Gradiente do ramo ativo (o que define o max), normalizado: normal externa.
export function tableNormal(x, y, z) {
    const side = x * x + z * z - 0.36 - 2.5 * (y - 0.8) * (y - 0.8);
    const bottom = -y;
    const top = y - TABLE_HEIGHT;

    let g;
    if (side >= bottom && side >= top) {
        g = [2 * x, -5 * (y - 0.8), 2 * z];
    } else if (top >= bottom) {
        g = [0, 1, 0];
    } else {
        g = [0, -1, 0];
    }

    const length = Math.hypot(g[0], g[1], g[2]) || 1;
    return [g[0] / length, g[1] / length, g[2] / length];
}

export function buildTableMesh() {
    return marchingCubes(tableField, tableNormal, {
        minX: -1.6, maxX: 1.6,
        minY: -0.2, maxY: 1.8,
        minZ: -1.6, maxZ: 1.6,
    }, TABLE_RESOLUTION);
}
