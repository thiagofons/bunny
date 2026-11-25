// Leitor de PLY ASCII (formato do Stanford Bunny: bun_zipper.ply).
// Retorna coords (x, y, z, 1 por vertice) e indices (triangulos).
export function parsePly(text) {
    const lines = text.split(/\r?\n/);
    let line = 0;
    const elements = [];

    if (lines[line++].trim() !== 'ply') {
        throw new Error('Arquivo PLY invalido.');
    }

    for (; line < lines.length;) {
        const tokens = lines[line++].trim().split(/\s+/);
        if (tokens[0] === 'format' && tokens[1] !== 'ascii') {
            throw new Error('Somente PLY ASCII e suportado.');
        }
        if (tokens[0] === 'element') {
            elements.push({ name: tokens[1], count: Number(tokens[2]), properties: [] });
        } else if (tokens[0] === 'property') {
            elements[elements.length - 1].properties.push(tokens.slice(1));
        } else if (tokens[0] === 'end_header') {
            break;
        }
    }

    const vertexElement = elements.find((e) => e.name === 'vertex');
    const faceElement = elements.find((e) => e.name === 'face');
    const names = vertexElement.properties.map((p) => p[1]);
    const ix = names.indexOf('x');
    const iy = names.indexOf('y');
    const iz = names.indexOf('z');

    const coords = new Float32Array(vertexElement.count * 4);
    for (let i = 0; i < vertexElement.count; i++) {
        const values = lines[line++].trim().split(/\s+/);
        coords[4 * i] = Number(values[ix]);
        coords[4 * i + 1] = Number(values[iy]);
        coords[4 * i + 2] = Number(values[iz]);
        coords[4 * i + 3] = 1;
    }

    const indices = [];
    for (let i = 0; i < faceElement.count; i++) {
        const values = lines[line++].trim().split(/\s+/).map(Number);
        const n = values[0];
        // Poligonos sao triangulados em leque (o bunny so tem triangulos).
        for (let k = 1; k + 1 < n; k++) {
            indices.push(values[1], values[1 + k], values[2 + k]);
        }
    }

    return { coords, indices: new Uint32Array(indices) };
}

export async function loadPly(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Nao foi possivel carregar o PLY: HTTP ${response.status}.`);
    }
    return parsePly(await response.text());
}
